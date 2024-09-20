/* eslint-disable @typescript-eslint/no-extraneous-class */
import type {ParserRuleContext} from "antlr4ng";
import type {TxJSONParser} from "./parser/TxJSONParser";
import {
  ValueError,
  indent,
  isValidIdent,
  safeObjectFromEntries
} from "./util";

export const enum NodeKind {
  Primitive = "primitive",
  Typed = "typed",
  Proto = "proto",
  Class = "class",
  Array = "array",
  Object = "object",
  Pair = "pair"
}
export type TxJsonValue =
  | string
  | number
  | boolean
  | null
  | symbol
  | bigint
  | RegExp
  | TxJsonArray
  | TxJsonObject
  | undefined;
export type TxJsonArray = TxJsonValue[];
export interface TxJsonObject {
  [key: string]: TxJsonValue | TxJsonObject | TxJsonArray;
}

export interface Accessor<M extends Meta, T extends Partial<Accessor<M, T>>> {
  get kind(): NodeKind;
  get rawValue(): TxJsonValue;
  get key(): string | undefined;
  get typeName(): string;
  get hasValue(): boolean;
  get children(): T[];
  get rule(): ParserRuleContext;
  get schema(): ActiveSchema<ISchema<M>>;
  get value(): any;
  get text(): string;
  get parent(): T | undefined;
  set parent(v: T | undefined);
  get ancestors(): T[];
  validate?(): void;
}

export type ValueAccessor<M extends Meta = Meta> = Accessor<
  M,
  ValueAccessor<M>
>;

export interface RawAccessor<M extends Meta = Meta>
  extends Omit<Accessor<M, RawAccessor<M>>, "value"> {
  set typeName(str: string);
}

export type Preprocessor<M extends Meta = Meta> = (
  value: RawAccessor<M>
) => void;
export type Validator<M extends Meta = Meta> = (
  value: RawAccessor<M>
) => Error | void;
export type Deserializer<M extends Meta = Meta> = (
  value: ValueAccessor<M>
) => any;

export type ActiveSchema<S extends ISchema<any> = ISchema> = Required<S> & {
  parser: TxJSONParser;
};

export type Meta = Record<string, any> & {
  fileName?: string;
};

export interface ISchema<M extends Meta = Meta> {
  prototypes: Record<string, Function | undefined>;
  classes: Record<string, Function>;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  deserializers: Record<"*" | string, Deserializer<M> | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  validators: Record<"*" | string, Validator<M> | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  preprocessors: Record<"*" | string, Preprocessor<M>>;
  meta: M;
}

export class Schema<M extends Meta = Meta> implements ISchema<M> {
  prototypes = Object.create(null) as ISchema<M>["classes"];
  classes = Object.create(null) as ISchema<M>["classes"];
  deserializers = Object.create(null) as ISchema<M>["deserializers"];
  validators = Object.create(null) as ISchema<M>["validators"];
  preprocessors = Object.create(null) as ISchema<M>["preprocessors"];
  meta = Object.create(null) as ISchema<M>["meta"];

  constructor(schema?: Partial<ISchema<M>>) {
    Object.assign(this.prototypes, schema?.prototypes);
    Object.assign(this.classes, schema?.classes);
    Object.assign(this.deserializers, schema?.deserializers);
    Object.assign(this.validators, schema?.validators);
    Object.assign(this.preprocessors, schema?.preprocessors);
    Object.assign(this.meta, schema?.meta);
  }
}

function createPrimitiveValidator<M extends Meta>(
  type: string | string[],
  chain?: Validator<M>
): Validator<M> {
  const types = Array.isArray(type) ? type : [type];
  return function (acc) {
    return types.includes(typeof acc.rawValue)
      ? chain?.(acc)
      : new ValueError(
          acc.parent ?? acc,
          `expected ${JSON.stringify(types.join("|"))}, found ${JSON.stringify(
            typeof acc.rawValue
          )}`
        );
  };
}

function createArrayValidator<M extends Meta>(
  type: string,
  elementValidator?: Validator<M>
): Validator<M> {
  return function (acc) {
    return acc.typeName === ":array"
      ? elementValidator
        ? acc.children.map((c) => elementValidator(c)).find((e) => !!e)
        : undefined
      : new ValueError(
          acc,
          `expected an array of type ${JSON.stringify(type)}`
        );
  };
}

function createSignatureValidator<M extends Meta>(
  signatures: string[],
  validators: Validator<M>[]
): Validator<M> {
  return function (acc) {
    const [arr] = acc.children;
    if (!arr || arr.typeName !== ":array") {
      return new ValueError(acc, `invalid argument`);
    }
    const errors = Object.create(null) as Record<number, Error>;
    arr.children.forEach((c, i) => {
      const e = validators[i]?.(c);
      if (e) {
        if (e instanceof ValueError) e.simplified = true;
        errors[i] = e;
      }
    });
    if (!Object.keys(errors).length) {
      return;
    }
    return new ValueError(
      acc,
      `invalid arguments\nvalidation failed with errors:\n  ${Object.entries(
        errors
      )
        .map(
          ([k, e]) =>
            `* in argument ${k} with signature \`${indent(
              signatures[parseInt(k)],
              1
            )}\`: ${indent(e.message, 2)}`
        )
        .join("\n  ")}`
    );
  };
}

function createIntValidator<M extends Meta>(
  types: string | string[],
  accepted: string | string[],
  chain?: Validator<M>
): Validator<M> {
  return createPrimitiveValidator<M>(accepted, function (acc) {
    return typeof acc.rawValue === "number"
      ? acc.rawValue % 1 !== 0
        ? new ValueError(
            acc.parent ?? acc,
            `non-integer value found for type ${JSON.stringify(
              Array.isArray(types) ? types.join("|") : types
            )}`
          )
        : chain?.(acc)
      : chain?.(acc);
  });
}

function createBoundNumberValidator<M extends Meta>(
  types: string | string[],
  accepted: string | string[],
  lower: number | bigint,
  upper: number | bigint,
  chain?: Validator<M>
) {
  return createPrimitiveValidator<M>(accepted, function (acc) {
    return typeof acc.rawValue === "number"
      ? acc.rawValue < lower || acc.rawValue > upper
        ? new ValueError(
            acc.parent ?? acc,
            `expected number in range ${lower.toString()}-${upper.toString()} for type ${JSON.stringify(
              Array.isArray(types) ? types.join("|") : types
            )}`
          )
        : chain?.(acc)
      : chain?.(acc);
  });
}

function createUintValidator<M extends Meta>(
  types: string | string[],
  accepted: string | string[],
  chain?: Validator<M>
): Validator<M> {
  return createIntValidator<M>(types, accepted, function (acc) {
    return typeof acc.rawValue === "number"
      ? acc.rawValue < 0
        ? new ValueError(
            acc.parent ?? acc,
            `expected positive value for type ${JSON.stringify(
              Array.isArray(types) ? types.join("|") : types
            )}`
          )
        : chain?.(acc)
      : chain?.(acc);
  });
}

function createTypedArrayValidator<M extends Meta>(
  type: string,
  elementValidator?: Validator<M>
): Validator<M> {
  return createSignatureValidator<M>(
    [`${type}[]`],
    [createArrayValidator(type, elementValidator)]
  );
}

const numericValidators /* : Record<string, Validator> */ = {
  int8: createUintValidator(
    "uint8",
    "number",
    createBoundNumberValidator("uint8", "number", -128, 127)
  ),
  uint8: createUintValidator(
    "uint8",
    "number",
    createBoundNumberValidator("uint8", "number", 0, 255)
  ),
  int16: createIntValidator(
    "uint16",
    "number",
    createBoundNumberValidator("uint16", "number", 0, 65535)
  ),
  uint16: createIntValidator(
    "int16",
    "number",
    createBoundNumberValidator("int16", "number", -32767, 32767)
  ),
  int32: createIntValidator(
    "int32",
    "number",
    createBoundNumberValidator("int32", "number", -2147483647, 2147483647)
  ),
  uint32: createIntValidator(
    "uint32",
    "number",
    createBoundNumberValidator("uint32", "number", 0, 4294967295)
  ),
  int64: createIntValidator("int64", ["number", "bigint"]),
  uint64: createUintValidator("uint64", ["number", "bigint"]),
  float32: createBoundNumberValidator(
    "float32",
    "number",
    1.175494e-38,
    3.4028237e38
  ),
  float64: createPrimitiveValidator("number")
};

export function createSchema<M extends Meta>(
  overrides?: Partial<Schema<M>>
): Schema<M> {
  const schema = new Schema<M>();
  schema.prototypes = Object.assign(
    Object.create(null) as Schema<M>["prototypes"],
    overrides?.prototypes
  );
  schema.classes = Object.assign(
    Object.create(null) as Schema<M>["classes"],
    {
      Uint8Array,
      Uint8ClampedArray,
      Int8Array,
      Uint16Array,
      Int16Array,
      Uint32Array,
      Int32Array,
      BigInt64Array,
      BigUint64Array,
      Float32Array,
      Float64Array,
      Map,
      Set,
      Date
    },
    overrides?.classes
  );
  schema.deserializers = Object.assign(
    Object.create(null) as Schema<M>["deserializers"],
    {
      bigint: (acc) => {
        try {
          if (
            typeof acc.rawValue === "bigint" ||
            typeof acc.rawValue === "string" ||
            typeof acc.rawValue === "number"
          ) {
            if (acc.rawValue === null) {
              return null;
            }
            return typeof acc.rawValue === "string" ||
              typeof acc.rawValue === "number"
              ? BigInt(acc.text)
              : acc.rawValue;
          } else {
            throw new ValueError(
              acc,
              `invalid bigint value: ${JSON.stringify(acc.rawValue)}`
            );
          }
        } catch (e) {
          if (e instanceof ValueError) {
            throw e;
          }
          if (e instanceof Error) throw new ValueError(acc, e.message);
          throw e;
        }
      },
      undefined: () => undefined,
      int: (v) => {
        return v.rawValue !== null
          ? parseInt(v.rawValue as string)
          : v.rawValue;
      },
      bool: undefined,
      boolean: undefined,
      float: (v) =>
        v.rawValue !== null ? parseFloat(v.rawValue as string) : v,
      number: (v) =>
        v.rawValue !== null ? parseFloat(v.rawValue as string) : v,
      string: undefined,
      any: undefined,
      object: undefined,
      array: undefined,
      null: undefined
    } as Schema<M>["deserializers"],
    overrides?.deserializers
  );
  const primitiveValidators: Schema<M>["validators"] = {
    ...numericValidators,
    Int8Array: createTypedArrayValidator("int8", numericValidators.int8),
    Uint8Array: createTypedArrayValidator("uint8", numericValidators.uint8),
    Uint8ClampedArray: createTypedArrayValidator(
      "uint8",
      numericValidators.uint8
    ),
    Int16Array: createTypedArrayValidator("int16", numericValidators.int16),
    Uint16Array: createTypedArrayValidator("uint16", numericValidators.uint16),
    Int32Array: createTypedArrayValidator("int32", numericValidators.int32),
    Uint32Array: createTypedArrayValidator("uint32", numericValidators.uint32),
    BigInt64Array: createTypedArrayValidator("int64", numericValidators.int64),
    BigUint64Array: createTypedArrayValidator(
      "uint64",
      numericValidators.uint64
    ),
    Float32Array: createTypedArrayValidator(
      "float32",
      numericValidators.float32
    ),
    Float64Array: createTypedArrayValidator(
      "float64",
      numericValidators.float64
    ),
    float: createPrimitiveValidator("number"),
    int: createIntValidator("int", "number"),
    uint: createUintValidator("uint", "number"),
    undefined: createPrimitiveValidator("undefined"),
    string: createPrimitiveValidator("string"),
    number: createPrimitiveValidator("number"),
    bigint: createPrimitiveValidator(
      ["bigint", "string", "number"],
      function (acc) {
        if (typeof acc.rawValue === "string") {
          if (!/^[-+]?\d+$/.test(acc.rawValue)) {
            return new ValueError(acc, "invalid bigint");
          }
        }
      }
    ),
    boolean: createPrimitiveValidator("boolean"),
    bool: createPrimitiveValidator("boolean"),
    object: createPrimitiveValidator("object", function (acc) {
      return acc.rawValue === null
        ? undefined
        : Array.isArray(acc.rawValue)
          ? new ValueError(
              acc,
              `non-object value found for built-in type "object"`
            )
          : undefined;
    }),
    array: function (acc) {
      return !Array.isArray(acc.rawValue)
        ? new ValueError(acc, `invalid built-in array value`)
        : undefined;
    }
  } as Schema<M>["validators"];
  schema.validators = Object.assign(
    Object.create(null) as Schema<M>["validators"],
    primitiveValidators,
    overrides?.validators
  );
  return schema;
}

export namespace Schema {
  export type SchemaMeta = Meta & {
    knownTypes: Set<string>;
  };
  export abstract class Type {
    constructor(public baseSchema: ISchema<SchemaMeta>) {}
    abstract signature: string;
    abstract validator: Validator<SchemaMeta>;
    abstract deserializer: Deserializer<SchemaMeta>;
    get preprocessor(): Preprocessor<SchemaMeta> | undefined {
      return undefined;
    }
  }

  export class Literal extends Type {
    constructor(
      baseSchema: ISchema<SchemaMeta>,
      public type: string,
      public value: unknown
    ) {
      super(baseSchema);
    }
    get signature() {
      const typeName = this.type.replace(/^:/, "");
      return `${
        isValidIdent(typeName) ? typeName : JSON.stringify(typeName)
      }(${JSON.stringify(this.value)})`;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      return this.baseSchema.deserializers[this.type] ?? ((acc) => acc.value);
    }
    get validator(): Validator<SchemaMeta> {
      return createPrimitiveValidator(typeof this.value, (acc) => {
        return acc.rawValue === this.value
          ? undefined
          : new ValueError(
              acc,
              `value mismatch, expected \`${this.signature}\``
            );
      });
    }
  }

  export class Maybe extends Type {
    constructor(
      baseSchema: Schema<SchemaMeta>,
      public inner: Type | null
    ) {
      super(baseSchema);
    }
    get signature() {
      return `${this.inner!.signature}?`;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      return function (acc) {
        if (
          !(acc.typeName in acc.schema.validators) &&
          !(acc.typeName in acc.schema.deserializers) &&
          !acc.typeName.startsWith(":")
        ) {
          throw new ValueError(
            acc,
            `unknown type ${JSON.stringify(acc.typeName)}`
          );
        }
        if (acc.rawValue === undefined || acc.rawValue === null) {
          return acc.rawValue;
        }
        if (acc.kind === NodeKind.Typed) {
          return acc.children[0].value;
        } else {
          return acc.value;
        }
      };
    }
    get validator(): Validator<SchemaMeta> {
      const innerValidator = this.inner!.validator;
      return function (acc) {
        if (acc.rawValue === undefined || acc.rawValue === null) {
          return;
        }
        if (
          !(acc.typeName in acc.schema.validators) &&
          !(acc.typeName in acc.schema.deserializers) &&
          !acc.typeName.startsWith(":")
        ) {
          return new ValueError(
            acc,
            `unknown type ${JSON.stringify(acc.typeName)}`
          );
        }
        return innerValidator(acc);
      };
    }
  }

  export class ArrayOf extends Type {
    constructor(
      baseSchema: Schema<SchemaMeta>,
      public inner: Type
    ) {
      super(baseSchema);
    }
    get signature() {
      return `${
        isValidIdent(this.inner.signature)
          ? this.inner.signature
          : `(${this.inner.signature})`
      }[]`;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      return (acc) => {
        const arr = acc.kind === NodeKind.Array ? acc : acc.children[0];
        return arr.children.map((v) => this.inner.deserializer(v));
      };
    }
    get validator(): Validator<SchemaMeta> {
      const inner = this.inner;
      const innerValidator = this.inner.validator;
      return function (acc) {
        if (!Array.isArray(acc.rawValue)) {
          return new ValueError(
            acc,
            `expected array of type \`${inner.signature}[]\``
          );
        }
        const [arr] = acc.children;
        if (!arr || arr.children.length === 0) {
          return;
        }
        for (const v of arr.children) {
          const e = innerValidator(v);
          if (e) {
            return e;
          }
        }
      };
    }
  }

  export class TObject extends Type {
    fields: Record<string, Type> | null;
    constructor(
      baseSchema: Schema<SchemaMeta>,
      fields: Type | Record<string, Type> | null
    ) {
      super(baseSchema);
      if (fields instanceof Type) {
        this.fields = null;
      } else {
        this.fields = Object.assign(
          Object.create(null),
          fields
        ) as TObject["fields"];
      }
    }
    get signature(): string {
      if (this.fields === null) return "object";
      const fields = Object.keys(this.fields).map(
        (k) => `${JSON.stringify(k)}: ${this.fields![k].signature}`
      );
      return `object { ${fields.join(", ")} }`;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      const { fields } = this;
      if (fields === null) {
        return function (acc) {
          return acc.value;
        };
      }
      return (acc) => {
        const deserializers = safeObjectFromEntries<
          ISchema<SchemaMeta>["deserializers"]
        >(
          Object.entries(fields).map(([k, v]) => [
            k,
            acc.schema.deserializers[k] ?? v.deserializer
          ])
        );
        return safeObjectFromEntries(
          (acc.typeName === ":object" ? acc : acc.children[0]).children.map(
            (kv) => {
              return [kv.key!, deserializers[kv.key!]!(kv.children[0])];
            }
          )
        );
      };
    }
    get validator(): Validator<SchemaMeta> {
      const { baseSchema, signature, fields } = this;
      if (fields === null) {
        return function (acc) {
          const obj = acc.typeName === ":object" ? acc : acc.children[0];
          if (!obj || obj.typeName !== ":object") {
            return new ValueError(obj, `expected object`);
          }
        };
      }
      const validators: Record<string, [boolean, Validator<SchemaMeta>]> =
        safeObjectFromEntries(
          Object.entries(fields).map(([k, v]) => [
            k,
            [v instanceof Maybe, v.validator]
          ])
        );
      return function (acc) {
        const obj = (
          acc.typeName === ":object" ? acc : acc.children[0]
        ) as Accessor<SchemaMeta, ValueAccessor<SchemaMeta>>;
        const { rawValue } = obj;
        if (
          !obj ||
          obj.typeName !== ":object" ||
          typeof acc.rawValue !== "object"
        ) {
          return new ValueError(
            acc,
            `expected object with signature \`${indent(signature, 1)}\``
          );
        }
        if (Array.isArray(rawValue)) {
          return new ValueError(
            acc,
            `expected object, found array: ${JSON.stringify(acc.rawValue)}`
          );
        }
        if (typeof rawValue !== "object") {
          return new ValueError(
            acc,
            `expected object, found ${JSON.stringify(acc.rawValue)}`
          );
        }
        if (rawValue === null) {
          return new ValueError(acc, `expected object, found null`);
        }
        const errors: Record<string, Error> = Object.create(null) as Record<
          string,
          Error
        >;
        for (const [k, [optional, validator]] of Object.entries(validators)) {
          const v = obj.children.find((v) => v.key === k)?.children[0];
          if (!v) {
            if (!optional) {
              errors[k] = new ValueError(
                acc,
                `missing field ${JSON.stringify(k)} of type: ${String(optional)}`,
                true
              );
            }
            continue;
          }
          const e = validator(v);
          if (e) {
            if (e instanceof ValueError) {
              e.simplified = true;
            }
            errors[k] = e;
          }
        }
        for (const k of Object.keys(rawValue)) {
          if (!(k in fields)) {
            errors[k] = new ValueError(
              acc,
              `unknown field ${JSON.stringify(k)} in object`,
              true
            );
          }
        }
        if (Object.keys(errors).length) {
          return new ValueError(
            acc,
            `expected object with signature \`${indent(
              signature,
              1
            )}\`\nvalidation failed with errors:\n  ${Object.entries(errors)
              .map(
                ([k, e]) =>
                  `* in field ${JSON.stringify(k)}: ${indent(e.message, 3)}`
              )
              .join("\n  ")}`
          );
        }
        return baseSchema.validators[obj.typeName]?.(obj);
      };
    }
  }

  export class OneOf extends Type {
    constructor(
      baseSchema: Schema<SchemaMeta>,
      public types: Type[],
      public namespace?: string
    ) {
      super(baseSchema);
    }
    get signature() {
      return this.types
        .map((t) =>
          !isValidIdent(t.signature) &&
          (t instanceof Terminal || t instanceof Alias)
            ? `(${t.signature})`
            : t.signature
        )
        .join("|");
    }
    get deserializer(): Deserializer<SchemaMeta> {
      const children = this.types.map(
        (t) =>
          [t.validator, t.deserializer] as [
            Validator<SchemaMeta>,
            Deserializer<SchemaMeta>
          ]
      );
      const { signature } = this;
      return function (acc) {
        const child = acc.kind === NodeKind.Typed ? acc.children[0] : acc;
        const errors: Error[] = [];
        for (const [validator, deserializer] of children) {
          if (deserializer) {
            try {
              if (!validator(child)) {
                return deserializer(child);
              }
            } catch (e) {
              if (e instanceof ValueError) errors.push(e);
              else if (e instanceof Error)
                errors.push(new ValueError(acc, e.message));
              else {
                throw e;
              }
            }
          }
        }
        throw new ValueError(
          acc,
          `could not deserialize value of type ${signature}: ${errors
            .map((e) =>
              e instanceof ValueError ? e.message : e.stack ?? e.message
            )
            .join("\n\t* ")}`
        );
      };
    }
    get validator(): Validator<SchemaMeta> {
      const children = this.types.map(
        (t) =>
          [t.signature, t.validator] as [
            string,
            Validator<SchemaMeta> | undefined
          ]
      );
      const { signature } = this;
      return function (acc) {
        const errors = Object.create(null) as Record<string, Error[]>;
        for (const [sig, validator] of children) {
          try {
            const e = validator?.(acc);
            if (!e) {
              return;
            }
            if (e instanceof ValueError) e.simplified = true;
            errors[sig] = errors[sig] ?? [];
            errors[sig].push(e);
          } catch (e) {
            /* do nothing */
          }
        }
        return new ValueError(
          acc,
          `expected: \`${indent(
            signature,
            1
          )}\`, validation failed with errors:\n${Object.entries(errors)
            .flatMap(([k, errs]) =>
              errs.map((e) => {
                return `  * alternative \`${indent(
                  k,
                  2
                )}\` failed with error: ${indent(e instanceof ValueError ? e.message : e.stack ?? e.message, 2)}`;
              })
            )
            .join("\n")}`
        );
      };
    }
  }
  export class ArrayFixed extends Type {
    constructor(
      baseSchema: Schema<SchemaMeta>,
      public types: Type[],
      public label = "array"
    ) {
      super(baseSchema);
    }
    get signature() {
      return `[${this.types.map((t) => t.signature).join(", ")}]`;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      return (acc) => {
        const arr = acc.typeName === ":array" ? acc : acc.children[0];
        return arr.children.map((v, i) =>
          this.types[i] instanceof Terminal
            ? v.value
            : this.types[i].deserializer(v)
        );
      };
    }
    get validator(): Validator<SchemaMeta> {
      const { types, signature, label } = this;
      const validators = types.map(
        (t) =>
          [t instanceof Maybe, t.validator] as [
            optional: boolean,
            validator: Validator<SchemaMeta> | undefined
          ]
      );
      return function (acc) {
        const arr = acc.typeName === ":array" ? acc : acc.children[0];
        if (!arr || arr.typeName !== ":array") {
          return new ValueError(acc, "invalid array");
        }
        const errors = Object.create(null) as Record<number, Error>;
        let i = 0;
        for (const [optional, validator] of validators) {
          if (i < arr.children.length) {
            const e = validator?.(arr.children[i]);
            if (e) {
              if (e instanceof ValueError) e.simplified = true;
              errors[i] = e;
            }
          } else if (!optional) {
            errors[i] = new ValueError(
              acc,
              `missing index ${i.toString()} of type: \`${types[i].signature}\``,
              true
            );
          }
          i++;
        }
        for (let j = i; j < arr.children.length; j++) {
          errors[j] = new ValueError(
            arr.children[j],
            `${label} length mismatch`,
            true
          );
        }
        if (!Object.keys(errors).length) {
          return;
        }
        return new ValueError(
          acc,
          `expected ${label} with signature \`${indent(
            signature,
            1
          )}\`\nvalidation failed with errors:\n  ${Object.entries(errors)
            .map(([k, e]) => `* at index ${k}: ${indent(e.message, 2)}`)
            .join("\n  ")}`
        );
      };
    }
  }

  export class Terminal extends Type {
    constructor(
      baseSchema: Schema<SchemaMeta>,
      public name: string
    ) {
      super(baseSchema);
    }
    get signature() {
      return this.name;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      return (acc) =>
        acc.kind === NodeKind.Primitive ? acc.value : acc.children[0].value;
    }
    get validator(): Validator<SchemaMeta> {
      const { name } = this;
      return function (acc) {
        return acc.schema.validators[name]?.(
          acc.typeName !== name && acc.kind !== NodeKind.Typed
            ? acc
            : acc.children[0]
        );
      };
    }
  }

  export class Alias extends Type {
    constructor(
      baseSchema: Schema<SchemaMeta>,
      public from: string | null,
      public to: string,
      public extraArgs?: Type | Type[] | null
    ) {
      super(baseSchema);
    }
    get signature() {
      return this.to;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      const { baseSchema, from, to } = this;
      return function (acc) {
        if (from && baseSchema.deserializers[from]) {
          return baseSchema.deserializers[from]!(acc);
        }
        const d = acc.schema.deserializers[to] ?? acc.schema.deserializers["*"];
        return d
          ? d(acc.typeName === from ? acc.children[0] : acc)
          : acc.kind === NodeKind.Typed
            ? acc.children[0].value
            : acc.value;
      };
    }
    get validator(): Validator<SchemaMeta> {
      const { baseSchema, from, to } = this;
      return function (acc) {
        if (from && baseSchema.validators[from]) {
          return baseSchema.validators[from]!(acc);
        }
        if (
          !(
            to in acc.schema.classes ||
            to in acc.schema.deserializers ||
            to in acc.schema.prototypes ||
            to in acc.schema.validators
          )
        ) {
          return new ValueError(
            acc,
            `missing aliased type ${JSON.stringify(to)}`
          );
        }
        const v = acc.schema.validators[to] ?? acc.schema.validators["*"];
        return v?.(
          acc.kind === NodeKind.Typed || acc.typeName === from
            ? acc.children[0]
            : acc
        );
      };
    }
  }

  export class Class extends Type {
    constructor(
      public baseSchema: Schema<SchemaMeta>,
      public className: string,
      public args?: ArrayFixed
    ) {
      super(baseSchema);
    }
    get signature() {
      return `class ${this.className}`;
    }
    get deserializer(): Deserializer<SchemaMeta> {
      return (acc) => acc.children[0].value;
    }
    get validator(): Validator<SchemaMeta> {
      const { className, baseSchema, args } = this;
      return function (acc) {
        if (!(className in acc.schema.classes)) {
          return new ValueError(
            acc,
            `missing class ${JSON.stringify(className)}`
          );
        }
        const e = acc.children.length
          ? args?.validator(acc.children[0])
          : undefined;
        if (e) return e;
        const v = baseSchema.validators[className];
        return v?.(acc);
      };
    }
  }
}

const schemaValidators = function (
  baseSchema: Schema<Schema.SchemaMeta>
): Schema<Schema.SchemaMeta>["validators"] {
  return {
    ":array": function (acc) {
      return acc.parent &&
        ["oneOf", "arrayOf", "class", "schema"].includes(acc.parent.typeName)
        ? undefined
        : new ValueError(acc, `unexpected array literal`);
    },
    ":object": function (acc) {
      return acc.parent &&
        ["class", "proto", "schema", "object", "array"].includes(
          acc.parent.typeName
        )
        ? undefined
        : new ValueError(
            acc,
            acc.parent?.typeName === ":document"
              ? `invalid input, document root must be of type \`schema\``
              : `unexpected object literal`
          );
    },
    ":document": function (acc) {
      return acc.children.length === 1 && acc.children[0].typeName === "schema"
        ? undefined
        : new ValueError(
            acc,
            `invalid input, document root must be of type \`schema\``
          );
    },
    schema: function (acc) {
      if (acc.parent?.typeName !== ":document") {
        return new ValueError(acc, `nested schemas are not supported`);
      }
      return acc.children[0].typeName === ":object"
        ? undefined
        : new ValueError(
            acc,
            "invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`"
          );
    },
    maybe: function (acc) {
      return acc.children[0].typeName !== ":undefined" &&
        acc.typeName !== ":null"
        ? undefined
        : new ValueError(acc, `missing type argument`);
    },
    oneOf: function (acc) {
      return acc.children[0].typeName === ":array"
        ? undefined
        : new ValueError(acc, `oneOf only accepts an array`);
    },
    arrayOf: function (acc) {
      return acc.children[0].typeName !== ":object"
        ? undefined
        : new ValueError(
            acc,
            "arrayOf accepts either one type or an array of types"
          );
    },
    class: function (acc) {
      const ancestors = acc.ancestors.filter(
        (a) => !a.typeName.startsWith(":")
      );
      if (
        ancestors.length > 2 ||
        (ancestors.length === 2 && ancestors[1].typeName !== "oneOf")
      ) {
        return new ValueError(
          acc,
          "classes may only be defined at the schema level or as part of a schema-level `oneOf` clause"
        );
      } else if (ancestors.length === 2) {
        const invalid = ancestors[1].children[0].children.filter(
          (c) => !/class|proto|object/.test(c.typeName)
        );
        if (invalid.length) {
          return new ValueError(
            acc.parent ?? acc,
            `unexpected ${JSON.stringify(
              invalid[0].typeName
            )} in \`oneOf [class, ...]\`, expected: class|proto|object`
          );
        }
      }
      if (getNamespace(acc)?.startsWith(":")) {
        return new ValueError(acc.parent ?? acc, "invalid class name");
      }
      return acc.children[0].typeName === ":array" ||
        acc.children[0].typeName === ":undefined"
        ? undefined
        : new ValueError(
            acc,
            "class only accepts an optional array of arguments"
          );
    },
    proto: function (acc) {
      const ancestors = acc.ancestors.filter(
        (a) => !a.typeName.startsWith(":")
      );
      if (
        ancestors.length > 2 ||
        (ancestors.length === 2 && ancestors[1].typeName !== "oneOf")
      ) {
        return new ValueError(
          acc,
          "prototypes may only be defined at the schema level or as part of a schema-level `oneOf` clause"
        );
      } else if (ancestors.length === 2) {
        const invalid = ancestors[1].children[0].children.filter(
          (c) => !/class|proto|object/.test(c.typeName)
        );
        if (invalid.length) {
          return new ValueError(
            acc.parent ?? acc,
            `unexpected ${JSON.stringify(
              invalid[0].typeName
            )} in \`oneOf [proto, ...]\`, expected: class|proto|object`
          );
        }
      }
      if (getNamespace(acc)?.startsWith(":")) {
        return new ValueError(acc.parent ?? acc, "invalid class name");
      }
      return acc.children[0].typeName === ":object" ||
        acc.children[0].typeName === ":undefined"
        ? undefined
        : new ValueError(
            acc,
            "proto only accepts an optional key-value mapping"
          );
    },
    object: function (acc) {
      return acc.children[0].typeName === ":object" ||
        acc.children[0].typeName === ":undefined"
        ? undefined
        : new ValueError(
            acc,
            "object only accepts an optional key-value mapping"
          );
    },
    "*": function (acc: RawAccessor<Schema.SchemaMeta>) {
      if (
        !acc.typeName.startsWith(":") &&
        ![
          acc.typeName in baseSchema.deserializers,
          acc.typeName in baseSchema.classes,
          acc.typeName in baseSchema.prototypes
        ].includes(true) &&
        !acc.schema.meta.knownTypes?.has(acc.typeName)
      ) {
        return new ValueError(
          acc.parent ?? acc,
          `unknown type ${acc.typeName}`
        );
      }
    }
  };
};

export const defaultSchema: Schema = createSchema();

export function createSchemaOfSchema(
  partialSchema: Partial<Schema> = defaultSchema
): Schema {
  const baseSchema = new Schema<Schema.SchemaMeta>(partialSchema as never);
  return new Schema<Schema.SchemaMeta>({
    meta: {
      knownTypes: new Set()
    },
    preprocessors: {
      ":document": function (acc) {
        if (
          typeof acc.rawValue === "object" &&
          acc.rawValue !== null &&
          !Array.isArray(acc.rawValue)
        ) {
          for (const key of Object.keys(acc.rawValue)) {
            acc.schema.meta.knownTypes.add(key);
          }
        }
      }
    },
    prototypes: safeObjectFromEntries<ISchema["prototypes"]>(
      Object.keys(baseSchema.prototypes).map((k) => [k, class Dummy {}])
    ),
    classes: safeObjectFromEntries<ISchema["classes"]>(
      Object.keys(baseSchema.classes).map((k) => [k, class Dummy {}])
    ),
    validators: Object.assign(
      Object.create(null) as ISchema<Schema.SchemaMeta>["validators"],
      baseSchema.validators,
      safeObjectFromEntries(
        Object.keys(baseSchema.validators)
          .filter((k) => !k.startsWith(":"))
          .map<[string, Validator<Schema.SchemaMeta> | undefined]>((k) => {
            return [k, undefined];
          })
      ),
      schemaValidators(baseSchema)
    ) as ISchema<Schema.SchemaMeta>["validators"],
    deserializers: Object.assign(
      safeObjectFromEntries(
        Object.keys(baseSchema.deserializers)
          // .filter((k) => !k.startsWith(':'))
          .map((k) => [
            k,
            (acc: ValueAccessor<Schema.SchemaMeta>) => {
              if (acc.parent?.kind === NodeKind.Pair) {
                if (acc.parent.parent?.parent?.typeName === "schema") {
                  return new Schema.Alias(
                    baseSchema,
                    acc.parent.key ?? null,
                    acc.typeName
                  );
                }
              }
              if (acc.schema.meta.knownTypes.has(acc.typeName)) {
                return new Schema.Alias(baseSchema, null, acc.typeName);
              }
              return new Schema.Terminal(baseSchema, k);
            }
          ])
      ),
      {
        schema: (acc) => {
          const value = acc.children[0].value as Record<string, Schema.Type>;
          return new Schema<Schema.SchemaMeta>({
            preprocessors: Object.assign(
              Object.create(null) as ISchema["preprocessors"],
              // ':document' in value ? {
              //   ':document': (acc: RawAccessor) => {
              //     if (!value[':document'].validator(acc)) {
              //       acc.typeName = value[':document'].signature;
              //     }
              //   },
              // } : {},
              baseSchema.preprocessors,
              safeObjectFromEntries(
                Object.entries(value).map(([k, v]) => [
                  k,
                  v.preprocessor ?? baseSchema.preprocessors[k]
                ])
              )
            ),
            prototypes: Object.assign(
              Object.create(null) as ISchema["prototypes"],
              baseSchema.prototypes
            ),
            classes: Object.assign(
              Object.create(null) as ISchema["classes"],
              baseSchema.classes
            ),
            validators: Object.assign(
              Object.create(null) as ISchema["validators"],
              safeObjectFromEntries(
                Object.entries(value).map(([k, v]) => [
                  k,
                  baseSchema.validators[k] ??
                    baseSchema.validators["*"] ??
                    v.validator
                ])
              ),
              baseSchema.validators
            ),
            deserializers: Object.assign(
              Object.create(
                null
              ) as ISchema<Schema.SchemaMeta>["deserializers"],
              baseSchema.deserializers,
              safeObjectFromEntries(
                Object.entries(value).map(([k, v]) => [
                  k,
                  baseSchema.deserializers[k] ??
                    baseSchema.deserializers["*"] ??
                    v.deserializer
                ])
              )
            ),
            meta: {
              schema: value,
              knownTypes: new Set(Object.keys(value))
            }
          });
        },
        ":undefined": () => new Schema.Terminal(baseSchema, "undefined"),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        object: (acc) => new Schema.TObject(baseSchema, acc.children[0].value),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        proto: (acc) => new Schema.TObject(baseSchema, acc.children[0].value),
        class: (acc) => {
          const className = getNamespace(acc)!;
          const [args] = acc.children;
          return new Schema.Class(
            baseSchema,
            className,
            args.typeName !== ":undefined"
              ? new Schema.ArrayFixed(
                  baseSchema,
                  args.value as Schema.Type[],
                  "arguments"
                )
              : undefined
          );
        },
        maybe: (a) =>
          new Schema.Maybe(baseSchema, a.children[0].value as Schema.Type),
        oneOf: (a) =>
          new Schema.OneOf(
            baseSchema,
            a.children[0].value as Schema.Type[],
            getNamespace(a)
          ),
        arrayOf: (acc) => {
          return Array.isArray(acc.children[0].value)
            ? new Schema.ArrayFixed(
                baseSchema,
                acc.children[0].value as Schema.Type[]
              )
            : new Schema.ArrayOf(
                baseSchema,
                acc.children[0].value as Schema.Type
              );
        },
        "*": function (acc) {
          return acc.kind === NodeKind.Primitive
            ? new Schema.Literal(acc.schema, acc.typeName, acc.rawValue)
            : new Schema.Alias(
                baseSchema,
                acc.parent?.key ?? null,
                acc.typeName,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                acc.children[0].value
              );
        }
      } as Schema<Schema.SchemaMeta>["deserializers"]
    )
  }) as unknown as Schema;
}

function getNamespace<M extends Meta>(acc: RawAccessor<M>): string | undefined {
  let current: RawAccessor<M> | undefined = acc;
  let lastPair: RawAccessor<M> | undefined = undefined;
  while (current && current.typeName !== ":root") {
    if (current.typeName === ":pair") lastPair = current;
    current = current.parent;
  }
  return lastPair?.key;
}
