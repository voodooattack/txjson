import type {ParserRuleContext} from 'antlr4ts/ParserRuleContext';
import type {TxJSONParser} from './parser/TxJSONParser';
import {
  ValueError,
  isValidIdent,
  indent,
  safeObjectFromEntries,
} from './util';

export const enum NodeKind {
  Primitive = 'primitive',
  Typed = 'typed',
  Proto = 'proto',
  Class = 'class',
  Array = 'array',
  Object = 'object',
  Pair = 'pair',
}

export interface Accessor<T extends Partial<Accessor<T>>> {
  get kind(): NodeKind;
  get rawValue(): any;
  get key(): string | undefined;
  get typeName(): string;
  get hasValue(): boolean;
  get children(): T[];
  get rule(): ParserRuleContext;
  get schema(): ActiveSchema;
  get value(): any;
  get parent(): T | undefined;
  set parent(v: T | undefined);
  get ancestors(): T[];
  validate?(): void;
}

export interface ValueAccessor extends Accessor<ValueAccessor> {}

export type InitialAccessor = Omit<ValueAccessor, 'value'>;

export interface RawAccessor extends Omit<Accessor<RawAccessor>, 'value'> {}

export type Preprocessor = (value: RawAccessor) => void;
export type Validator = (value: RawAccessor) => Error | void;
export type Deserializer = (value: InitialAccessor) => any;

export type ActiveSchema = Required<Schema> & {
  parser: TxJSONParser;
};

export type Meta = Record<string, any> & {
  fileName?: string;
};

export interface ISchema {
  prototypes: Record<string, Function | undefined>;
  classes: Record<string, Function>;
  deserializers: Record<'*' | string, Deserializer | undefined>;
  validators: Record<'*' | string, Validator | undefined>;
  preprocessors: Record<'*' | string, Preprocessor>;
  meta: Meta;
}

export class Schema implements ISchema {
  prototypes = Object.create(null) as ISchema['classes'];
  classes = Object.create(null) as ISchema['classes'];
  deserializers = Object.create(null) as ISchema['deserializers'];
  validators = Object.create(null) as ISchema['validators'];
  preprocessors = Object.create(null) as ISchema['preprocessors'];
  meta: Meta = Object.create(null) as ISchema['meta'];

  constructor(schema?: Partial<ISchema>) {
    Object.assign(this.prototypes, schema?.prototypes);
    Object.assign(this.classes, schema?.classes);
    Object.assign(this.deserializers, schema?.deserializers);
    Object.assign(this.validators, schema?.validators);
    Object.assign(this.preprocessors, schema?.preprocessors);
    Object.assign(this.meta, schema?.meta);
  }
}

function createPrimitiveValidator(
  type: string | string[],
  chain?: Validator,
): Validator {
  const types = Array.isArray(type) ? type : [type];
  return function(acc) {
    return types.includes(typeof acc.rawValue) ?
      chain?.(acc) :
      new ValueError(
        acc.parent ?? acc,
        `expected ${JSON.stringify(types.join('|'))}, found ${JSON.stringify(
          typeof acc.rawValue,
        )}`,
      );
  };
}

function createArrayValidator(
  type: string,
  elementValidator?: Validator,
): Validator {
  return function(acc) {
    return acc.typeName === ':array' ?
      elementValidator ?
        acc.children.map((c) => elementValidator(c)).find((e) => !!e) :
        undefined :
      new ValueError(
        acc,
        `expected an array of type ${JSON.stringify(type)}`,
      );
  };
}

function createSignatureValidator(
  signatures: string[],
  validators: Validator[],
): Validator {
  return function(acc) {
    const [arr] = acc.children;
    if (!arr || arr.typeName !== ':array') {
      return new ValueError(acc, `invalid argument`);
    }
    const errors: Record<number, Error> = Object.create(null);
    arr.children.forEach((c, i) => {
      const e = validators[i]?.(c);
      if (e) {
        if (e instanceof ValueError) e.simple = true;
        errors[i] = e;
      }
    });
    if (!Object.keys(errors).length) {
      return;
    }
    return new ValueError(
      acc,
      `invalid arguments\nvalidation failed with errors:\n  ${Object.entries(
        errors,
      )
        .map(
          ([k, e]) =>
            `* in argument ${k} with signature \`${indent(
              signatures[parseInt(k)],
              1,
            )}\`: ${indent(e.message, 2)}`,
        )
        .join('\n  ')}`,
    );
  };
}

function createIntValidator(
  types: string | string[],
  accepted: string | string[],
  chain?: Validator,
): Validator {
  return createPrimitiveValidator(accepted, function(acc) {
    return acc.rawValue % 1 !== 0 ?
      new ValueError(
        acc.parent ?? acc,
        `non-integer value found for type ${JSON.stringify(
          Array.isArray(types) ? types.join('|') : types,
        )}`,
      ) :
      chain?.(acc);
  });
}

function createBoundNumberValidator(
  types: string | string[],
  accepted: string | string[],
  lower: number | BigInt,
  upper: number | BigInt,
  chain?: Validator,
) {
  return createPrimitiveValidator(accepted, function(acc) {
    return acc.rawValue < lower || acc.rawValue > upper ?
      new ValueError(
        acc.parent ?? acc,
        `expected number in range ${lower}-${upper} for type ${JSON.stringify(
          Array.isArray(types) ? types.join('|') : types,
        )}`,
      ) :
      chain?.(acc);
  });
}

function createUintValidator(
  types: string | string[],
  accepted: string | string[],
  chain?: Validator,
): Validator {
  return createIntValidator(types, accepted, function(acc) {
    return acc.rawValue < 0 ?
      new ValueError(
        acc.parent ?? acc,
        `expected positive value for type ${JSON.stringify(
          Array.isArray(types) ? types.join('|') : types,
        )}`,
      ) :
      chain?.(acc);
  });
}

function createTypedArrayValidator(
  type: string,
  elementValidator?: Validator,
): Validator {
  return createSignatureValidator(
    [`${type}[]`],
    [createArrayValidator(type, elementValidator)],
  );
}

const numericValidators /* : Record<string, Validator> */ = {
  int8: createUintValidator(
    'uint8',
    'number',
    createBoundNumberValidator('uint8', 'number', -128, 127),
  ),
  uint8: createUintValidator(
    'uint8',
    'number',
    createBoundNumberValidator('uint8', 'number', 0, 255),
  ),
  int16: createIntValidator(
    'uint16',
    'number',
    createBoundNumberValidator('uint16', 'number', 0, 65535),
  ),
  uint16: createIntValidator(
    'int16',
    'number',
    createBoundNumberValidator('int16', 'number', -32767, 32767),
  ),
  int32: createIntValidator(
    'int32',
    'number',
    createBoundNumberValidator('int32', 'number', -2147483647, 2147483647),
  ),
  uint32: createIntValidator(
    'uint32',
    'number',
    createBoundNumberValidator('uint32', 'number', 0, 4294967295),
  ),
  int64: createIntValidator('int64', ['number', 'bigint']),
  uint64: createUintValidator('uint64', ['number', 'bigint']),
  float32: createBoundNumberValidator(
    'float32',
    'number',
    1.175494e-38,
    3.4028237e38,
  ),
  float64: createPrimitiveValidator('number'),
};

export function createSchema(overrides?: Partial<Schema>): Schema {
  const schema: Schema = new Schema();
  schema.prototypes = Object.assign(Object.create(null), overrides?.prototypes);
  schema.classes = Object.assign(
    Object.create(null),
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
    },
    overrides?.classes,
  );
  schema.deserializers = Object.assign(
    Object.create(null),
    {
      bigint: (acc) => {
        try {
          return BigInt(acc.rawValue);
        } catch (e: any) {
          throw new ValueError(acc, e.message);
        }
      },
      undefined: () => undefined,
      int: (v) => {
        return parseInt(v.rawValue);
      },
      bool: undefined,
      boolean: undefined,
      float: (v) => parseFloat(v.rawValue),
      number: (v) => parseFloat(v.rawValue),
      string: undefined,
      any: undefined,
      object: undefined,
      array: undefined,
      null: undefined,
    } as Schema['deserializers'],
    overrides?.deserializers,
  );
  const primitiveValidators: Schema['validators'] = {
    ...numericValidators,
    Int8Array: createTypedArrayValidator('int8', numericValidators.int8),
    Uint8Array: createTypedArrayValidator('uint8', numericValidators.uint8),
    Uint8ClampedArray: createTypedArrayValidator(
      'uint8',
      numericValidators.uint8,
    ),
    Int16Array: createTypedArrayValidator('int16', numericValidators.int16),
    Uint16Array: createTypedArrayValidator('uint16', numericValidators.uint16),
    Int32Array: createTypedArrayValidator('int32', numericValidators.int32),
    Uint32Array: createTypedArrayValidator('uint32', numericValidators.uint32),
    BigInt64Array: createTypedArrayValidator('int64', numericValidators.int64),
    BigUint64Array: createTypedArrayValidator(
      'uint64',
      numericValidators.uint64,
    ),
    Float32Array: createTypedArrayValidator(
      'float32',
      numericValidators.float32,
    ),
    Float64Array: createTypedArrayValidator(
      'float64',
      numericValidators.float64,
    ),
    float: createPrimitiveValidator('number'),
    int: createIntValidator('int', 'number'),
    uint: createUintValidator('uint', 'number'),
    undefined: createPrimitiveValidator('undefined'),
    string: createPrimitiveValidator('string'),
    number: createPrimitiveValidator('number'),
    bigint: createPrimitiveValidator(
      ['bigint', 'string', 'number'],
      function(acc) {
        if (typeof acc.rawValue === 'string') {
          if (!/^[-+]?\d+$/.test(acc.rawValue)) {
            return new ValueError(acc, 'invalid bigint');
          }
        }
      },
    ),
    boolean: createPrimitiveValidator('boolean'),
    bool: createPrimitiveValidator('boolean'),
    object: createPrimitiveValidator('object', function(acc) {
      return acc.rawValue === null ?
        undefined :
        Array.isArray(acc.rawValue) ?
          new ValueError(
            acc,
            `non-object value found for built-in type "object"`,
          ) :
          undefined;
    }),
    array: function(acc) {
      return !Array.isArray(acc.rawValue) ?
        new ValueError(acc, `invalid built-in array value`) :
        undefined;
    },
  };
  schema.validators = Object.assign(
    Object.create(null),
    primitiveValidators,
    overrides?.validators,
  );
  return schema;
}

export namespace Schema {
  export abstract class Type {
    constructor(public baseSchema: Schema) {}
    abstract signature: string;
    abstract validator: Validator;
    get deserializer(): Deserializer | undefined {
      return undefined;
    }
  }

  export class Literal extends Type {
    constructor(baseSchema: Schema, public type: string, public value: any) {
      super(baseSchema);
    }
    get signature() {
      const typeName = this.type.replace(/^:/, '');
      return `${
        isValidIdent(typeName) ? typeName : JSON.stringify(typeName)
      } ${JSON.stringify(this.value)}`;
    }
    get deserializer(): Deserializer | undefined {
      return this.baseSchema.deserializers[this.type];
    }
    get validator(): Validator {
      return createPrimitiveValidator(typeof this.value, (acc) => {
        return acc.rawValue === this.value ?
          undefined :
          new ValueError(
            acc,
            `value mismatch, expected \`${this.signature}\``,
          );
      });
    }
  }

  export class Maybe extends Type {
    constructor(baseSchema: Schema, public inner: Type | null) {
      super(baseSchema);
    }
    get signature() {
      return `${this.inner!.signature}?`;
    }
    get deserializer(): Deserializer | undefined {
      return function(acc) {
        const child = acc.children[0];
        if (
          !(acc.typeName in acc.schema.validators) &&
          !(acc.typeName in acc.schema.deserializers) &&
          !acc.typeName.startsWith(':')
        ) {
          throw new ValueError(
            acc,
            `unknown type ${JSON.stringify(acc.typeName)}`,
          );
        }
        if (child.rawValue === undefined || child.rawValue === null) {
          return child.rawValue;
        }
        return child.value;
      };
    }
    get validator(): Validator {
      const innerValidator = this.inner!.validator;
      return function(acc) {
        if (
          !(acc.typeName in acc.schema.validators) &&
          !(acc.typeName in acc.schema.deserializers) &&
          !acc.typeName.startsWith(':')
        ) {
          return new ValueError(
            acc,
            `unknown type ${JSON.stringify(acc.typeName)}`,
          );
        }
        if (acc.rawValue === undefined || acc.rawValue === null) {
          return;
        }
        return innerValidator(acc);
      };
    }
  }

  export class ArrayOf extends Type {
    constructor(baseSchema: Schema, public inner: Type) {
      super(baseSchema);
    }
    get signature() {
      return `${this.inner.signature}[]`;
    }
    get validator(): Validator {
      const inner = this.inner;
      const innerValidator = this.inner.validator;
      return function(acc) {
        if (!Array.isArray(acc.rawValue)) {
          return new ValueError(
            acc,
            `expected array of type \`${inner.signature}[]\``,
          );
        }
        const [arr] = acc.children;
        for (const v of arr.children) {
          const e = innerValidator(v);
          if (e) return e;
        }
      };
    }
  }

  export class TObject extends Type {
    fields: Record<string, Type> | null;
    constructor(baseSchema: Schema, fields: Type | Record<string, Type>) {
      super(baseSchema);
      if (fields instanceof Type) {
        this.fields = null;
      } else {
        this.fields = Object.assign(Object.create(null), fields);
      }
    }
    get signature(): string {
      if (this.fields === null) return 'object';
      const fields = Object.keys(this.fields).map(
        (k) => `  ${JSON.stringify(k)}: ${this.fields![k].signature},`,
      );
      return `object {\n${fields.join('\n')}\n}`;
    }
    get validator(): Validator {
      const {baseSchema, signature, fields} = this;
      if (fields === null) {
        return function(acc) {
          const obj = acc.typeName === ':object' ? acc : acc.children[0];
          if (!obj || obj.typeName !== ':object') {
            return new ValueError(acc, `expected object`);
          }
        };
      }
      const validators = safeObjectFromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          [v instanceof Maybe, v?.validator],
        ]),
      ) as Record<string, [optional: boolean, validator: Validator]>;
      return function(acc) {
        const obj = acc.typeName === ':object' ? acc : acc.children[0];
        if (!obj || obj.typeName !== ':object') {
          return new ValueError(
            acc,
            `expected object with signature \`${indent(signature, 1)}\``,
          );
        }
        const errors: Record<string, Error> = Object.create(null);
        for (const [k, [t, validator]] of Object.entries(validators)) {
          const v = obj.children.find((v) => v.key === k)?.children[0];
          if (!v) {
            if (!t) {
              errors[k] = new ValueError(
                acc,
                `missing field ${JSON.stringify(k)} of type: ${t}`,
                true,
              );
            }
            continue;
          }
          const e = validator?.(v);
          if (e) {
            if (e instanceof ValueError) {
              e.simple = true;
            }
            errors[k] = e;
          }
        }
        for (const k of Object.keys(obj.rawValue)) {
          if (!(k in fields)) {
            errors[k] = new ValueError(
              acc,
              `unknown field ${JSON.stringify(k)} in object`,
              true,
            );
          }
        }
        if (Object.keys(errors).length) {
          return new ValueError(
            acc,
            `expected object with signature \`${indent(
              signature,
              1,
            )}\`\nvalidation failed with errors:\n  ${Object.entries(errors)
              .map(
                ([k, e]) =>
                  `* in field ${JSON.stringify(k)}: ${indent(e.message, 3)}`,
              )
              .join('\n  ')}`,
          );
        }
        return baseSchema.validators[obj.typeName]?.(obj);
      };
    }
  }

  export class OneOf extends Type {
    constructor(
      baseSchema: Schema,
      public types: Type[],
      public namespace?: string,
    ) {
      super(baseSchema);
    }
    get signature() {
      return this.types
        .map((t) =>
          !isValidIdent(t.signature) && (t instanceof Alias || t instanceof Terminal) ?
            `(${t.signature})` :
            t.signature,
        )
        .join(' | ');
    }
    get deserializer(): Deserializer {
      const children = this.types.map((t) => [t.validator, t.deserializer]);
      const {signature} = this;
      if (this.namespace && this.namespace in this.baseSchema.deserializers) {
        return this.baseSchema.deserializers[this.namespace]!;
      }
      return function(acc) {
        const child = acc.children[0];
        const errors: Error[] = [];
        for (const [validator, deserializer] of children) {
          if (deserializer) {
            try {
              if (!validator?.(acc)) {
                return deserializer(acc);
              }
            } catch (e: any) {
              errors.push(e);
            }
          }
        }
        if (errors.length) {
          throw new ValueError(
            acc,
            `could not deserialize value of type ${signature}: ${errors
              .map((e) => e.message)
              .join('\n\t* ')}`,
          );
        }
        return child.value;
      };
    }
    get validator(): Validator {
      const children = this.types.map(
        (t) => [t.signature, t.validator] as [string, Validator | undefined],
      );
      const {signature} = this;
      return function(acc) {
        const errors: Record<string, Error[]> = Object.create(null);
        for (const [sig, validator] of children) {
          try {
            const e = validator?.(acc);
            if (!e) {
              return;
            }
            if (e instanceof ValueError) e.simple = true;
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
            1,
          )}\`, validation failed with errors:\n${Object.entries(errors)
            .flatMap(([k, errs]) =>
              errs.map(
                (e) =>
                  `  * alternative \`${indent(
                    k,
                    2,
                  )}\` failed with error: ${indent(e.message, 2)}`,
              ),
            )
            .join('\n')}`,
        );
      };
    }
  }
  export class ArrayFixed extends Type {
    constructor(
      baseSchema: Schema,
      public types: Type[],
      public label = 'array',
    ) {
      super(baseSchema);
    }
    get signature() {
      return `[${this.types.map((t) => t.signature).join(', ')}]`;
    }
    get validator(): Validator {
      const {types, signature, label} = this;
      const validators = types.map(
        (t) =>
          [t instanceof Maybe, t.validator] as [
            optional: boolean,
            validator: Validator | undefined
          ],
      );
      return function(acc) {
        const arr = acc.typeName === ':array' ? acc : acc.children[0];
        if (arr.typeName !== ':array') {
          /* return */ new ValueError(acc, 'invalid array');
        }
        const errors: Record<number, Error> = Object.create(null);
        let i = 0;
        for (const [optional, validator] of validators) {
          if (i < arr.children.length) {
            const e = validator?.(arr.children[i]);
            if (e) {
              if (e instanceof ValueError) e.simple = true;
              errors[i] = e;
            }
          } else if (!optional) {
            errors[i] = new ValueError(
              acc,
              `missing index ${i} of type: \`${types[i].signature}\``,
              true,
            );
          }
          i++;
        }
        for (let j = i; j < arr.children.length; j++) {
          errors[j] = new ValueError(
            arr.children[j],
            `${label} length mismatch`,
            true,
          );
        }
        if (!Object.keys(errors).length) {
          return;
        }
        return new ValueError(
          acc,
          `expected ${label} with signature \`${indent(
            signature,
            1,
          )}\`\nvalidation failed with errors:\n  ${Object.entries(errors)
            .map(([k, e]) => `* at index ${k}: ${indent(e.message, 2)}`)
            .join('\n  ')}`,
        );
      };
    }
  }

  export class Terminal extends Type {
    constructor(baseSchema: Schema, public name: string) {
      super(baseSchema);
    }
    get signature() {
      return this.name;
    }
    get deserializer(): Deserializer | undefined {
      return this.baseSchema.deserializers[this.name];
    }
    get validator(): Validator {
      const {name} = this;
      return (
        this.baseSchema.validators[name] ??
        function(acc) {
          return acc.schema.validators[name]?.(acc);
        }
      );
    }
  }

  export class Alias extends Type {
    constructor(
      public schema: Schema,
      baseSchema: Schema,
      public from: string,
      public to: string,
      public extraArgs?: Type | Type[],
    ) {
      super(baseSchema);
    }
    get signature() {
      return this.to;
    }
    get deserializer(): Deserializer | undefined {
      return (
        this.baseSchema.deserializers[this.from] ??
        this.baseSchema.deserializers[this.to]
      );
    }
    get validator(): Validator {
      const self = this;
      return function(acc) {
        const v = acc.schema.validators[self.to];
        if (!v) {
          return new ValueError(
            acc,
            `missing aliased type ${JSON.stringify(self.to)}`,
          );
        }
        return v(
          acc.typeName.startsWith(':') || acc.typeName === self.to ?
            acc :
            acc.children[0],
        );
      };
    }
  }

  export class Class extends Type {
    constructor(
      public baseSchema: Schema,
      public className: string,
      public args?: ArrayFixed,
    ) {
      super(baseSchema);
      if (!className) debugger;
    }
    get signature() {
      return `class ${this.className}`;
    }
    get validator(): Validator {
      const {className, baseSchema, args} = this;
      return function(acc) {
        if (!(className in acc.schema.classes)) {
          return new ValueError(
            acc,
            `missing class ${JSON.stringify(className)}`,
          );
        }
        const e = args?.validator?.(acc.children[0]);
        if (e) return e;
        const v = baseSchema.validators[className];
        return v?.(acc);
      };
    }
  }
}

const schemaValidators = function(baseSchema: Schema): Schema['validators'] {
  return {
    ':array': function(acc) {
      return acc.parent &&
        ['oneOf', 'arrayOf', 'class', 'schema'].includes(acc.parent.typeName) ?
        undefined :
        new ValueError(acc, `unexpected array literal`);
    },
    ':object': function(acc) {
      return acc.parent &&
        ['class', 'proto', 'schema', 'object', 'array'].includes(
          acc.parent!.typeName,
        ) ?
        undefined :
        new ValueError(
          acc,
          acc.parent?.typeName === ':document' ?
            `invalid input, document root must be of type \`schema\`` :
            `unexpected object literal`,
        );
    },
    ':document': function(acc) {
      return acc.children.length === 1 && acc.children[0].typeName === 'schema' ?
        undefined :
        new ValueError(
          acc,
          `invalid input, document root must be of type \`schema\``,
        );
    },
    'schema': function(acc) {
      if (acc.parent?.typeName !== ':document') {
        return new ValueError(acc, `nested schemas are not supported`);
      }
      return acc.children[0].typeName === ':object' ?
        undefined :
        new ValueError(
          acc,
          'invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`',
        );
    },
    'maybe': function(acc) {
      return acc.children[0].typeName !== ':undefined' &&
        acc.typeName !== ':null' ?
        undefined :
        new ValueError(acc, `missing type argument`);
    },
    'oneOf': function(acc) {
      return acc.children[0].typeName === ':array' ?
        undefined :
        new ValueError(acc, `oneOf only accepts an array`);
    },
    'arrayOf': function(acc) {
      return acc.children[0].typeName !== ':object' ?
        undefined :
        new ValueError(
          acc,
          'arrayOf accepts either one type or an array of types',
        );
    },
    'class': function(acc) {
      const ancestors = acc.ancestors.filter((a) => !/^:/.test(a.typeName));
      if (
        ancestors.length > 2 ||
        (ancestors.length === 2 && ancestors[1].typeName !== 'oneOf')
      ) {
        return new ValueError(
          acc,
          'classes may only be defined at the schema level or as part of a schema-level `oneOf` clause',
        );
      } else if (ancestors.length === 2) {
        const invalid = ancestors[1].children[0].children.filter(
          (c) => !/class|proto|object/.test(c.typeName),
        );
        if (invalid.length) {
          return new ValueError(
            acc.parent!,
            `unexpected ${JSON.stringify(
              invalid[0].typeName,
            )} in \`oneOf [class, ...]\`, expected: class|proto|object`,
          );
        }
      }
      if (getNamespace(acc)?.startsWith(':')) {
        return new ValueError(acc.parent!, 'invalid class name');
      }
      return acc.children[0].typeName === ':array' ||
        acc.children[0].typeName === ':undefined' ?
        undefined :
        new ValueError(
          acc,
          'class only accepts an optional array of arguments',
        );
    },
    'proto': function(acc) {
      const ancestors = acc.ancestors.filter((a) => !/^:/.test(a.typeName));
      if (
        ancestors.length > 2 ||
        (ancestors.length === 2 && ancestors[1].typeName !== 'oneOf')
      ) {
        return new ValueError(
          acc,
          'prototypes may only be defined at the schema level or as part of a schema-level `oneOf` clause',
        );
      } else if (ancestors.length === 2) {
        const invalid = ancestors[1].children[0].children.filter(
          (c) => !/class|proto|object/.test(c.typeName),
        );
        if (invalid.length) {
          return new ValueError(
            acc.parent!,
            `unexpected ${JSON.stringify(
              invalid[0].typeName,
            )} in \`oneOf [proto, ...]\`, expected: class|proto|object`,
          );
        }
      }
      if (getNamespace(acc)?.startsWith(':')) {
        return new ValueError(acc.parent!, 'invalid class name');
      }
      return acc.children[0].typeName === ':object' ||
        acc.children[0].typeName === ':undefined' ?
        undefined :
        new ValueError(
          acc,
          'proto only accepts an optional key-value mapping',
        );
    },
    'object': function(acc) {
      return acc.children[0].typeName === ':object' ||
        acc.children[0].typeName === ':undefined' ?
        undefined :
        new ValueError(
          acc,
          'object only accepts an optional key-value mapping',
        );
    },
    '*': function(acc: RawAccessor) {
      if (
        !acc.typeName.startsWith(':') &&
        ![
          acc.typeName in baseSchema.deserializers,
          acc.typeName in baseSchema.classes,
          acc.typeName in baseSchema.prototypes,
        ].includes(true) &&
        !acc.schema.meta.knownTypes.has(acc.typeName)
      ) {
        return new ValueError(
          acc.parent ?? acc,
          `unknown type ${acc.typeName}`,
        );
      }
    },
  };
};

export const defaultSchema: Schema = createSchema();

export function createSchemaOfSchema(
  partialSchema: Partial<Schema> = defaultSchema,
): Schema {
  const baseSchema = new Schema(partialSchema);
  return new Schema({
    meta: {
      knownTypes: new Set(),
    },
    preprocessors: {
      ':document': function(acc) {
        if (
          typeof acc.rawValue === 'object' &&
          acc.rawValue !== null &&
          !Array.isArray(acc.rawValue)
        ) {
          for (const key of Object.keys(acc.rawValue)) {
            acc.schema.meta.knownTypes.add(key);
          }
        }
      },
    },
    prototypes: safeObjectFromEntries(
      Object.keys(baseSchema.prototypes).map((k) => [k, class Dummy {}]),
    ) as Schema['prototypes'],
    classes: safeObjectFromEntries(
      Object.keys(baseSchema.classes).map((k) => [k, class Dummy {}]),
    ) as Schema['classes'],
    validators: Object.assign(
      Object.create(null),
      baseSchema.validators,
      safeObjectFromEntries(
        Object.keys(baseSchema.validators)
          .filter((k) => !k.startsWith(':'))
          .map<[string, Validator]>((k) => {
            return [
              k,
              function(a) {
                // if (a.typeName.startsWith(':')) debugger;
                return a.rawValue === undefined ||
                  a.rawValue === null ||
                  typeof a.rawValue === 'object' ?
                  undefined :
                  new ValueError(a, 'no literal values are allowed.');
              },
            ];
          }),
      ),
      schemaValidators(baseSchema),
    ),
    deserializers: Object.assign(
      safeObjectFromEntries(
        Object.keys(baseSchema.deserializers)
          // .filter((k) => !k.startsWith(':'))
          .map((k) => [
            k,
            (acc: ValueAccessor) => {
              if (!(acc.children[0].value instanceof Schema.Type)) debugger;
              return new Schema.Terminal(baseSchema, k);
            },
          ]),
      ),
      {
        'schema': (acc) => {
          const value = acc.children[0].value;
          return new Schema({
            prototypes: Object.assign(
              Object.create(null),
              baseSchema.prototypes,
            ),
            classes: Object.assign(Object.create(null), baseSchema.classes),
            validators: Object.assign(
              Object.create(null),
              baseSchema.validators,
              safeObjectFromEntries(
                Object.entries(value as Record<PropertyKey, Schema.Type>).map(
                  ([k, v]) => [k, v.validator],
                ),
              ),
            ),
            deserializers: Object.assign(
              Object.create(null),
              baseSchema.deserializers,
              safeObjectFromEntries(
                Object.entries(value as Record<PropertyKey, Schema.Type>).map(
                  ([k, v]) => [k, v.deserializer ?? baseSchema.deserializers[k]],
                ),
              ),
            ),
            meta: {
              schema: acc.children[0].value,
            },
          });
        },
        ':undefined': () => new Schema.Terminal(baseSchema, 'undefined'),
        'object': (acc) => new Schema.TObject(baseSchema, acc.children[0].value),
        'proto': (acc) => new Schema.TObject(baseSchema, acc.children[0].value),
        'class': (acc) => {
          const className = getNamespace(acc)!;
          const [args] = acc.children;
          return new Schema.Class(
            baseSchema,
            className,
            args.typeName !== ':undefined' ?
              new Schema.ArrayFixed(baseSchema, args.value, 'arguments') :
              undefined,
          );
        },
        'maybe': (a) => new Schema.Maybe(baseSchema, a.children[0].value),
        'oneOf': (a) =>
          new Schema.OneOf(baseSchema, a.children[0].value, getNamespace(a)),
        'arrayOf': (acc) => {
          return Array.isArray(acc.children[0].value) ?
            new Schema.ArrayFixed(baseSchema, acc.children[0].value) :
            new Schema.ArrayOf(baseSchema, acc.children[0].value);
        },
        '*': function(acc) {
          return !(acc.children[0]?.value instanceof Schema.Type) ?
            new Schema.Literal(acc.schema, acc.typeName, acc.rawValue) :
            new Schema.Alias(
              acc.schema,
              baseSchema,
              getNamespace(acc)!,
              acc.typeName,
              acc.children[0].value,
            );
        },
      } as Schema['deserializers'],
    ),
  });
}

function getNamespace(acc: RawAccessor) {
  let current: RawAccessor | undefined = acc;
  let lastPair: RawAccessor | undefined = undefined;
  while (current && current.typeName !== ':root') {
    if (current.typeName === ':pair') lastPair = current;
    current = current.parent;
  }
  return lastPair?.key;
}
