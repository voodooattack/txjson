import {use} from 'chai';
import equalBytes from 'chai-bytes';

import {createSchema, parse, parseSchema} from '../src/index';

const {expect} = use(equalBytes);

describe('TxJSON schema', function(this: Mocha.Suite) {
  class Test {
    constructor(public a: number, public b: string, ...extra: any[]) {
      Object.assign(this, {extra});
    }
  }
  class Dummy {}
  const schemaStr = `schema {
    X: maybe oneOf [bigint, number],
    Y: any,
    Z: ExternalRef,
    W: oneOf [1, 2, 3],
    AorB: oneOf [int, string],
    AandB: arrayOf [int, string],
    C: object {
      a: X,
      b: string,
      c: undefined
    },
    D: C,
    AnyClass: class,
    Test: class [int, string],
    MyObject: object {a: int, b: int, c: int},
    Dummy: oneOf [class [], proto {a: int, b: int, c: int}],
  }`;
  const subSchema = createSchema({
    classes: {
      Test,
      Dummy,
    },
    prototypes: {
      Dummy,
    },
    deserializers: {
      X: (a) => BigInt(a.children[0].value),
      ExternalRef: (acc) =>
        'externally_referenced_type: ' + JSON.stringify(acc.rawValue),
    },
  });
  it('can parse schema', function() {
    const schema = parseSchema(schemaStr, subSchema);
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13] = parse(
      `[
        X bigint "123",
        X null,
        AorB "aaa",
        AandB [1, "aaa"],
        AorB 123,
        C { a: 1, b: "test", c: undefined },
        D { a: null, b: "x", c: undefined },
        Test(1, "3"),
        Dummy(),
        Dummy... {
          a: 1,
          b: 2,
          c: 3,
        },
        [Y "test", Y 1, Y true, Y undefined, Z 0],
        W 2,
        Z "ext",
      ]`,
      schema,
    );
    expect(r1).to.equal(123n);
    expect(r2).to.equal(null);
    expect(r3).to.equal('aaa');
    expect(r4).to.deep.equal([1, 'aaa']);
    expect(r5).to.equal(123);
    expect(r6).to.deep.equal({
      a: 1,
      b: 'test',
      c: undefined,
    });
    expect(r7).to.deep.equal({
      a: null,
      b: 'x',
      c: undefined,
    });
    expect(r8).to.be.instanceOf(Test);
    expect(r8).to.deep.equal(new Test(1, '3'));
    expect(r9).to.be.instanceOf(Dummy);
    expect(r9).to.deep.equal(new Dummy());
    expect(r10).to.be.instanceOf(Dummy);
    expect(r10).to.deep.equal({
      a: 1,
      b: 2,
      c: 3,
    });
    expect(r11).to.deep.equal([
      'test',
      1,
      true,
      undefined,
      'externally_referenced_type: 0',
    ]);
    expect(r12).to.equal(2);
    expect(r13).to.equal('externally_referenced_type: "ext"');
  });

  it('can validate schema', function() {
    const schema = parseSchema(schemaStr, subSchema);
    expect(() =>
      parse(`D {a: "invalid", b: "aaa", c: 1 }`, schema, '/src/aaa/test.txjson'),
    ).to.throw(
      '/src/aaa/test.txjson(1,2): error in expression `{a: "invalid", b: "aaa", c: 1 }`: expected object with signature `object {\n    "a": X,\n    "b": string,\n    "c": undefined,\n  }`\nvalidation failed with errors:\n  * in field "a": (1,6): in expression `"invalid"`: expected: `bigint | number`, validation failed with errors:\n        * alternative `bigint` failed with error: (1,6): in expression `"invalid"`: invalid bigint\n        * alternative `number` failed with error: (1,3): in expression `a: "invalid"`: expected "number", found "string"\n  * in field "c": (1,27): in expression `c: 1`: expected "undefined", found "number"',
    );
    expect(() => parse(`X YYY`, schema)).to.throw('unknown type "YYY"');
    expect(() => parse(`Test(1, "2", 3)`, schema)).to.throw(
      'expected arguments with signature `[int, string]`',
    );
    expect(() => parse(`Dummy(1, "2", 3)`, schema)).to.throw(
      `expected arguments with signature \`[]\``,
    );
    expect(() => parse(`Dummy...`, schema)).to.throw(
      'syntax error at 1:8, mismatched input \'<EOF>\' expecting \'{\'',
    );
    expect(() => parse(`Dummy... {}`)).to.throw('unknown prototype "Dummy"');
    expect(() => parse(`DoesNotExist(1, "2", 3)`, schema)).to.throw(
      'unknown class "DoesNotExist"',
    );
    expect(() => parse(`W 8`, schema)).to.throw(
      'expected: `number 1 | number 2 | number 3`',
    );
  });

  it('can validate document root', function() {
    const schema = parseSchema(`
      schema {
        ':document': arrayOf int,
      }
    `);
    expect(parse(`[1, 2, 3]`, schema)).to.deep.eq([1, 2, 3]);
    expect(() => parse(`[1.2, 2, 3]`, schema)).to.throw(
      'non-integer value found for type "int"',
    );
    expect(() => parse(`{}`, schema)).to.throw(
      'expected array of type `int[]`',
    );
  });

  it('can validate a practical example', function() {
    const schema = parseSchema(
      `
      schema {
        /// Use \`:document\` to restrict the type of a document's root.
        ":document": arrayOf Place,
        // a literal object signature
        Place: object {
          // \`id\` can be a string or a number
          id: oneOf [string, number],
          name: string,
          cat: Category,
          // \`maybe\` makes the following type optional (e.g can be \`undefined\` or \`null\`)
          description: maybe string,
          coords: maybe oneOf [arrayOf Point, Point],
          address: maybe string,
          phone: maybe string,
          // \`tags\` is a dynamic string array of any length.
          tags: maybe arrayOf string,
          // You can pass literal values to match against. This can be used to define enums with \`oneOf\`!
          status: oneOf ["published", "private", "hidden"],
        },
        Category: oneOf [
          "accomodation",
          "shopping",
          "parks_and_recreation",
          "restaurant",
        ],
        // Definition of a GeoJSON point.
        Point: oneOf [
          // A plain object.
          object {
            type: "Point", // A fixed string!
            coordinates: arrayOf [number, number, maybe number], // A fixed array signature
            bbox: maybe arrayOf [number, number, number, number], // \`maybe\` makes this field optional
          },
          // A class version of the same object.
          class [number, number]
        ],
      }
    `,
      createSchema({
        classes: {
          Point: class Point {
            type = 'Point';
            coordinates: [number, number];
            constructor(x: number, y: number) {
              this.coordinates = [x, y];
            }
          },
        },
      }),
      'places.schema.txson',
    );
    expect(parse(`[]`)).to.deep.eq([]);
    expect(() => parse(`{}`, schema)).to.throw(
      'expected array of type `Place[]`',
    );
    expect(
      parse(
        `[{
           id: 0,
           name: "The good place",
           cat: "accomodation",
           status: "published",
           description: null,
           coords: Point(10, 10),
           address: "123 Afterlife St.",
           tags: ["great amenities", "free wifi"],
        }]`,
        schema,
      ),
    ).to.deep.eq([
      {
        id: 0,
        name: 'The good place',
        cat: 'accomodation',
        status: 'published',
        description: null,
        coords: {
          type: 'Point',
          coordinates: [10, 10],
        },
        address: '123 Afterlife St.',
        tags: ['great amenities', 'free wifi'],
      },
    ]);
  });

  it('errors on invalid schema', function() {
    expect(() =>
      parseSchema(`schema []`, undefined, 'test.schema.txjson'),
    ).to.throw(
      'test.schema.txjson(1,0): error in expression `schema []`: invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`',
    );
    expect(() => parseSchema(`{}`, undefined)).to.throw(
      'invalid input, document root must be of type `schema`',
    );
    expect(() => parseSchema(`schema undefined`, undefined)).to.throw(
      'invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`',
    );
    expect(() => parseSchema(`schema 1`, undefined)).to.throw(
      'invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`',
    );
    expect(() => parseSchema(`schema {x: [maybe int]}`, undefined)).to.throw(
      `unexpected array literal`,
    );
    expect(() => parseSchema(`[schema {x: maybe null}]`, undefined)).to.throw(
      'nested schemas are not supported',
    );
    expect(() =>
      parseSchema(`schema { x: schema {x: int} }`, undefined),
    ).to.throw('nested schemas are not supported');
    expect(() => parseSchema(`[schema {x: {a: int}}]`, undefined)).to.throw(
      'unexpected object literal',
    );
    expect(() => parseSchema(`schema { x: class 1 }`, undefined)).to.throw(
      'class only accepts an optional array of arguments',
    );
    expect(() => parseSchema(`schema { x: proto 1 }`, undefined)).to.throw(
      'proto only accepts an optional key-value mapping',
    );
    expect(() => parseSchema(`schema { x: class {} }`, undefined)).to.throw(
      'class only accepts an optional array of arguments',
    );
    expect(() =>
      parseSchema(`schema { x: arrayOf class [] }`, undefined),
    ).to.throw(
      'classes may only be defined at the schema level or as part of a schema-level `oneOf` clause',
    );
    expect(() =>
      parseSchema(`schema { x: oneOf [class [], int] }`, undefined),
    ).to.throw(
      'unexpected "int" in `oneOf [class, ...]`, expected: class|proto|object',
    );
    expect(() =>
      parseSchema(`schema { ':document': class }`, undefined),
    ).to.throw('invalid class name');
    expect(() =>
      parseSchema(`schema { x: arrayOf proto {} }`, undefined),
    ).to.throw(
      'prototypes may only be defined at the schema level or as part of a schema-level `oneOf` clause',
    );
    expect(() =>
      parseSchema(`schema { x: oneOf [proto {}, int] }`, undefined),
    ).to.throw(
      'unexpected "int" in `oneOf [proto, ...]`, expected: class|proto|object',
    );
    expect(() =>
      parseSchema(`schema { ':document': proto {} }`, undefined),
    ).to.throw('invalid class name');
  });
  it('misc', function() {
    expect(() =>
      parse(
        `X ["aaa", {"x": int 0, y: []}]`,
        parseSchema(`
      schema { X: arrayOf [string, oneOf [object, arrayOf object]] }
    `),
      ),
    ).to.not.throw();
    parse(
      `X [Y "zz", Z 2]`,
      parseSchema(`
        schema { X: arrayOf oneOf [Y, Z], Y: string, Z: number }
    `),
    );
    expect(() =>
      parse(
        `X [Y "zz", Z 2]`,
        parseSchema(`
        schema { X: arrayOf oneOf [Y, Z], Y: string, Z: number }
    `),
      ),
    ).to.not.throw();
    expect(
      parse(
        '[X 1, X "2"]',
        parseSchema(
          `schema {X: oneOf [int, string]}`,
          createSchema({
            deserializers: {
              X: () => 'override',
            },
          }),
        ),
      ),
    ).to.deep.equal(['override', 'override']);
    expect(
      parse(
        '[X [1, "2"], X [2, "3"], Y [3, "4"]]',
        parseSchema(
          `schema {X: arrayOf [int, string], Y: X}`,
          createSchema({
            deserializers: {
              Y: () => 'override',
            },
          }),
        ),
      ),
    ).to.deep.equal([[1, '2'], [2, '3'], 'override']);
    expect(
      parse(
        'VARIANT STRUCT ["STRUCT(x INTEGER, y INTEGER)", {"x": INT "1", "y": INT "2"}]',
        parseSchema(
          `schema {
            INT: string,
            STRUCT: arrayOf [string, oneOf [object, arrayOf object]],
            ANY: oneOf [INT, STRUCT],
            VARIANT: ANY,
          }`,
          createSchema({
            deserializers: {},
          }),
        ),
      ),
    ).to.deep.equal([
      'STRUCT(x INTEGER, y INTEGER)', {
        x: '1',
        y: '2',
      },
    ]);
    expect(
      parse(
        `[
          variant int 1,
          variant string "x",
          variant Y(),
          variant C [X 1, X "a", { o: X 1, p: int 12, q: 12.2 }]
        ]`,
        parseSchema(
          `schema {
            Y: class,
            X: oneOf [int, string, boolean],
            C: arrayOf [int, string, object],
            any: oneOf [int, string, bigint, boolean, float, Y, C, X],
            variant: any,
          }`,
          createSchema({
            deserializers: {
              variant: (acc) =>
                `variant ${JSON.stringify(acc.children[0].value)}`,
              c: (acc) => `${acc.children[0].value}`,
              X: () => 'X',
            },
            classes: {
              Y: class Y {
                get [Symbol.toStringTag]() {
                  return 'Y';
                }
              },
            },
          }),
        ),
      ),
    ).to.deep.equal([
      'variant 1',
      'variant "x"',
      'variant {}',
      'variant ["X","X",{"o":"X","p":12,"q":12.2}]',
    ]);
  });
});
