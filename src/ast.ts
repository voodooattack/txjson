/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type {ErrorNode, ParserRuleContext} from "antlr4ng";
import unescape from "unescape-js";
import type {TxJSONListener} from "./parser/TxJSONListener";
import type {
  ObjContext,
  PairContext,
  RootContext,
  TArrayContext,
  TBQuoteStringContext,
  TBigIntContext,
  TBooleanContext,
  TCtorContext,
  TNullContext,
  TNumberContext,
  TProtoContext,
  TRegExpContext,
  TUndefinedContext,
  TxJSONParser,
  TypedValueContext
} from "./parser/TxJSONParser";
import {
  TStringContext,
  TValueContext,
  ValueContext
} from "./parser/TxJSONParser";
import type {ActiveSchema, Schema, TxJsonValue, ValueAccessor} from "./schema";
import {NodeKind} from "./schema";
import {ValueError, getExpression} from "./util";

const emptyValue = Symbol.for("TXJSON_EMPTY");

function processStringLiteral(str: string) {
  str = str.replace(/\\\n/g, ""); // remove line continuations
  return unescape(str);
}

abstract class ASTNode implements ValueAccessor {
  _parent?: ValueAccessor;
  _value: any = emptyValue;
  constructor(
    public rule: ParserRuleContext,
    public schema: ActiveSchema,
    private _typeName: string,
    private _rawValue?: TxJsonValue,
    private _text: string = rule.getText()
  ) {}
  get expression() {
    return getExpression(this);
  }
  get typeName() {
    return this._typeName;
  }
  set typeName(name: string) {
    if (this.kind !== NodeKind.Typed) {
      if (this.parent) {
        const pIdx = this.parent.children.indexOf(this);
        if (typeof pIdx !== "undefined" && pIdx !== -1) {
          const n = new TypedValueNode(this.rule, this.schema, name);
          n.child = this;
          this.parent.children[pIdx] = n;
        }
      } else if (this.children[0]) {
        this.children[0] = new TypedValueNode(this.rule, this.schema, name);
        this.children[0].children[0] = this;
      }
      return;
    }
    this._typeName = name;
  }
  public get key(): string | undefined {
    return;
  }
  public get parent(): ValueAccessor | undefined {
    return this._parent;
  }
  public set parent(v: ValueAccessor | undefined) {
    this._parent = v;
  }
  get ancestors() {
    const arr: ValueAccessor[] = [];
    let parent = this.parent;
    while (parent) {
      arr.unshift(parent);
      parent = parent.parent;
    }
    return arr;
  }
  public get value() {
    if (this.hasValue) return this._value;
    else if (this.getValue) {
      return (this._value = this.getValue());
    } else return (this._value = this._rawValue);
  }
  public get rawValue() {
    return this._rawValue;
  }
  public get text() {
    return this._text;
  }

  public get hasValue() {
    return this._value !== emptyValue;
  }
  protected abstract getValue(): any;
  public validate(): void {
    if (
      !(
        this.typeName.startsWith(":") ||
        "*" in this.schema.validators ||
        this.typeName in this.schema.classes ||
        this.typeName in this.schema.prototypes ||
        this.typeName in this.schema.deserializers ||
        this.typeName in this.schema.validators
      )
    ) {
      throw new ValueError(
        this,
        `unknown type ${JSON.stringify(this.typeName)}`
      );
    }
    const e = (
      this.schema.validators[this.typeName] ?? this.schema.validators["*"]
    )?.(this);
    if (e) throw e;
  }
  public abstract preprocess(): void;
  public abstract get kind(): NodeKind;
  public abstract get children(): ValueAccessor[];
}

abstract class SimpleNode extends ASTNode {
  public child?: ASTNode;
  public override validate() {
    this.child?.validate();
    super.validate();
  }
  public override preprocess(): void {
    this.child?.preprocess();
  }
  protected override getValue() {
    return super.hasValue ? this.rawValue : this.child?.value;
  }
  public override get rawValue() {
    return this.child?.rawValue;
  }
  public override get children(): ValueAccessor[] {
    return this.child ? [this.child] : [];
  }
}

abstract class CompoundNode extends ASTNode {
  public children: ASTNode[] = [];
  protected override getValue() {
    return this.children.map((c) => c.value);
  }
  public override get rawValue() {
    return this.children.map((c) => c.rawValue);
  }
  public override preprocess(): void {
    this.children.forEach((c) => {
      c.preprocess();
    });
  }
  public override validate(): void {
    for (const child of this.children) {
      child.validate();
    }
    super.validate();
  }
}

class PrimitiveNode extends ASTNode {
  public get children(): ValueAccessor[] {
    return [];
  }
  public get kind() {
    return NodeKind.Primitive;
  }
  protected getValue() {
    return (
      (
        this.schema.deserializers[this.typeName] ??
        this.schema.deserializers["*"]
      )?.(this) ?? this.rawValue
    );
  }
  public preprocess(): void {
    if (this.schema.preprocessors[this.typeName])
      this.schema.preprocessors[this.typeName](this);
  }
}

class ArrayNode extends CompoundNode {
  constructor(rule: ParserRuleContext, schema: ActiveSchema) {
    super(rule, schema, ":array");
  }
  public get kind() {
    return NodeKind.Array;
  }
  protected override getValue(): any[] {
    return this.children.map((v) => v.value);
  }
  public get rawValue() {
    return this.children.map((v) => v.rawValue);
  }
}

class PairNode extends SimpleNode {
  public get kind() {
    return NodeKind.Pair;
  }
  constructor(
    rule: ParserRuleContext,
    schema: ActiveSchema,
    private _key: string
  ) {
    super(rule, schema, ":pair");
  }
  public get key(): string {
    return this._key;
  }
  protected override getValue(): any {
    return this.child?.value;
  } 
  get rawValue() {
    return this.child?.rawValue;
  }
}

class ObjectNode extends CompoundNode {
  constructor(rule: ParserRuleContext, schema: ActiveSchema) {
    super(rule, schema, ":object");
  }
  public get kind(): NodeKind {
    return NodeKind.Object;
  }
  public children: PairNode[] = [];
  protected override getValue(): any {
    return this.children.reduce((p, n) => {
      return Object.assign(p, { [n.key]: n.value });
    }, Object.create(null));
  }
  get rawValue(): any {
    return this.children.reduce((p, n) => {
      return Object.assign(p, { [n.key]: n.rawValue });
    }, Object.create(null));
  }
}

function extractRuleValueText(rule: ParserRuleContext | null) {
  if (rule === null) {
    return;
  }
  if (rule instanceof ValueContext) {
    return extractRuleValueText(rule.getChild(0) as ParserRuleContext);
  }
  if (rule instanceof TStringContext) {
    return processStringLiteral(rule.getText().slice(1, -1));
  }
  if (rule instanceof TValueContext) {
    return extractRuleValueText(rule.value());
  } else {
    return rule.getText();
  }
}

class TypedValueNode extends SimpleNode {
  public get kind() {
    return NodeKind.Typed;
  }
  constructor(
    rule: TypedValueContext | TValueContext,
    schema: ActiveSchema,
    typeName: string
  ) {
    super(rule, schema, typeName, undefined, extractRuleValueText(rule));
  }
  get rawValue(): any {
    return this.child?.rawValue;
  }
  public preprocess(): void {
    if (this.schema.preprocessors[this.typeName])
      this.schema.preprocessors[this.typeName](this);
    super.preprocess();
  }
  protected override getValue(): any {
    const {
      deserializers = Object.create(null) as Schema["deserializers"],
      validators = Object.create(null) as Schema["validators"]
    } = this.schema;
    if (this.typeName in deserializers || this.typeName in validators) {
      if (deserializers[this.typeName] !== undefined) {
        return deserializers[this.typeName]!(this);
      }
      return this.child?.value;
    } else if ("*" in deserializers) {
      return deserializers["*"]!(this);
    } else if (this.typeName.startsWith(":")) {
      return this.child?.value;
    }
    throw new ValueError(this, `unknown type ${JSON.stringify(this.typeName)}`);
  }
}

class ProtoConstructionNode extends SimpleNode {
  public get kind() {
    return NodeKind.Proto;
  }
  constructor(
    rule: ParserRuleContext,
    public schema: ActiveSchema,
    typeName: string
  ) {
    super(rule, schema, typeName);
  }
  public override validate() {
    const { prototypes = Object.create(null) } = this.schema;
    if (!(this.typeName in prototypes)) {
      throw new ValueError(
        this,
        `unknown prototype ${JSON.stringify(this.typeName)}`
      );
    }
    super.validate();
  }
  protected override getValue(): any {
    const { prototypes = Object.create(null) } = this.schema;
    if (this.typeName in prototypes) {
      const childVal = this.child?.value;
      return Object.assign(
        Object.create(prototypes[this.typeName].prototype),
        childVal ?? {}
      );
    }
    throw new ValueError(
      this,
      `unknown prototype ${JSON.stringify(this.typeName)}`
    );
  }
}

class CtorCallValueNode extends CompoundNode {
  public get kind() {
    return NodeKind.Class;
  }
  constructor(
    rule: ParserRuleContext,
    public schema: ActiveSchema,
    typeName: string
  ) {
    super(rule, schema, typeName);
  }
  public override validate() {
    const { classes = Object.create(null) } = this.schema;
    if (!(this.typeName in classes)) {
      throw new ValueError(
        this,
        `unknown class ${JSON.stringify(this.typeName)}`
      );
    }
    super.validate();
  }
  protected override getValue(): any {
    const { classes = Object.create(null) } = this.schema;
    if (this.typeName in classes) {
      const [args] = this.children;
      const val = args.children.map((c) => c.value);
      return new classes[this.typeName](...val);
    }
    throw new ValueError(
      this,
      `unknown class ${JSON.stringify(this.typeName)}`
    );
  }
}

export class TxListener implements TxJSONListener {
  visitTerminal = () => {
    /**
     * Do nothing
     */
  };

  public stack: ASTNode[][] = [[]];
  public schema: ActiveSchema;
  public root!: ASTNode;

  constructor(
    public parser: TxJSONParser,
    schema: Partial<Schema> = {
      classes: {},
      deserializers: {},
      validators: {}
    }
  ) {
    if (!schema.classes) schema.classes = {};
    if (!schema.deserializers) schema.deserializers = {};
    if (!schema.validators) schema.validators = {};
    this.schema = Object.assign(Object.create(null), schema) as ActiveSchema;
    this.schema.classes = Object.assign(Object.create(null), schema.classes);
    this.schema.deserializers = Object.assign(
      Object.create(null),
      schema.deserializers
    );
    this.schema.validators = Object.assign(
      Object.create(null),
      schema.validators
    );
    this.schema.parser = parser;
  }

  visitErrorNode(_node: ErrorNode): void {
    /** do nothing */
  }
  enterEveryRule(_node: ParserRuleContext): void {
    /** do nothing */
  }
  exitEveryRule(_node: ParserRuleContext): void {
    /** do nothing */
  }

  get nodes() {
    return this.stack[this.stack.length - 1];
  }

  beginNode() {
    this.stack.push([]);
  }

  endNode(ctx: ParserRuleContext, node: ASTNode) {
    this.nodes.forEach((n) => (n.parent = node));
    if (node instanceof SimpleNode) {
      if (this.nodes.length > 1) {
        /* istanbul ignore next */
        throw new Error(`Invalid state!`);
      }
      if (!this.nodes.length && node instanceof TypedValueNode) {
        this.addNode(
          ctx,
          new PrimitiveNode(ctx, this.schema, ":undefined", undefined)
        );
      }
      node.child = this.stack.pop()?.[0];
    } else if (node instanceof CompoundNode) {
      node.children = this.stack.pop()!;
    } else if (this.nodes.length === 0) {
      this.stack.pop();
    } else {
      throw new Error(`Invalid state!`);
    }
    return this.addNode(ctx, node);
  }

  addNode(_ctx: ParserRuleContext, node: ASTNode) {
    node.children.forEach((n) => (n.parent = node));
    this.nodes.push(node);
    return node;
  }

  enterRoot() {
    this.beginNode();
  }

  exitRoot(ctx: RootContext) {
    this.root = this.endNode(
      ctx,
      new TypedValueNode(ctx, this.schema, ":document")
    );
    this.root.preprocess();
    this.root.validate();
  }

  enterTArray() {
    this.beginNode();
  }

  exitTArray(ctx: TArrayContext) {
    this.endNode(ctx, new ArrayNode(ctx, this.schema));
  }

  enterTCtor() {
    this.beginNode();
    this.beginNode();
  }

  exitTCtor(ctx: TCtorContext) {
    this.endNode(ctx, new ArrayNode(ctx, this.schema));
    this.endNode(
      ctx,
      new CtorCallValueNode(ctx, this.schema, ctx.IDENTIFIER().getText())
    );
  }

  enterObj() {
    this.beginNode();
  }

  exitObj(ctx: ObjContext) {
    this.endNode(ctx, new ObjectNode(ctx, this.schema));
  }

  enterTValue() {
    this.beginNode();
  }

  exitTValue(ctx: TValueContext) {
    this.endNode(
      ctx,
      new TypedValueNode(ctx, this.schema, ctx.IDENTIFIER().getText())
    );
  }

  enterTProto() {
    this.beginNode();
  }

  exitTProto(ctx: TProtoContext) {
    this.endNode(
      ctx,
      new ProtoConstructionNode(ctx, this.schema, ctx.IDENTIFIER().getText())
    );
  }

  enterPair() {
    this.beginNode();
  }

  exitPair(ctx: PairContext) {
    const text = ctx.key().STRING()
      ? processStringLiteral(ctx.key().STRING()!.getText().slice(1, -1))
      : ctx.key().getText();
    this.endNode(ctx, new PairNode(ctx, this.schema, text));
  }

  enterTBQuoteString(_ctx: TBQuoteStringContext) {
    this.beginNode();
  }

  exitTBQuoteString(ctx: TBQuoteStringContext) {
    const text = processStringLiteral(
      ctx.BQUOTE_STRING().getText().slice(1, -1).replace(/\\`/g, "`")
    );
    this.endNode(ctx, new PrimitiveNode(ctx, this.schema, ":string", text));
  }

  enterTString() {
    this.beginNode();
  }

  exitTString(ctx: TStringContext) {
    const text = processStringLiteral(ctx.STRING().getText().slice(1, -1));
    this.endNode(ctx, new PrimitiveNode(ctx, this.schema, ":string", text));
  }

  enterTBoolean() {
    this.beginNode();
  }

  exitTBoolean(ctx: TBooleanContext) {
    this.endNode(
      ctx,
      new PrimitiveNode(ctx, this.schema, ":boolean", ctx.getText() === "true")
    );
  }

  enterTNull() {
    this.beginNode();
  }

  exitTNull(ctx: TNullContext) {
    this.endNode(ctx, new PrimitiveNode(ctx, this.schema, ":null", null));
  }

  enterTUndefined() {
    this.beginNode();
  }

  exitTUndefined(ctx: TUndefinedContext) {
    this.endNode(
      ctx,
      new PrimitiveNode(ctx, this.schema, ":undefined", undefined)
    );
  }

  enterTNumber() {
    this.beginNode();
  }

  exitTNumber(ctx: TNumberContext) {
    this.endNode(
      ctx,
      new PrimitiveNode(ctx, this.schema, ":number", parseFloat(ctx.getText()))
    );
  }

  enterTBigInt() {
    this.beginNode();
  }

  exitTBigInt(ctx: TBigIntContext) {
    this.endNode(
      ctx,
      new PrimitiveNode(
        ctx,
        this.schema,
        ":bigint",
        BigInt(ctx.getText().replace(/n$/, ""))
      )
    );
  }

  exitTRegExp(ctx: TRegExpContext) {
    const [, exp, flags] = ctx.getText().match(/^\/(.*)\/(\w+)*$/)!;
    this.addNode(
      ctx,
      new PrimitiveNode(ctx, this.schema, ":regexp", new RegExp(exp, flags))
    );
  }
}
