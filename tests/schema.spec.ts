import {use} from "chai";
import equalBytes from "chai-bytes";
import {createSchema, parse, parseSchema} from "../src/index";
import {safeObjectFromEntries} from "../src/util";

const { expect } = use(equalBytes);

describe("TxJSON schema", function (this: Mocha.Suite) {
  class Test {
    constructor(
      public a: number,
      public b: string,
      ...extra: any[]
    ) {
      Object.assign(this, { extra });
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
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
      Dummy
    },
    prototypes: {
      Dummy
    },
    deserializers: {
      ExternalRef: (acc) =>
        "externally_referenced_type: " + JSON.stringify(acc.rawValue)
    }
  });
  it("can parse schema", function () {
    const schema = parseSchema(schemaStr, subSchema);
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13] = parse<
      unknown[]
    >(
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
      schema
    );
    expect(r1).to.equal(123n);
    expect(r2).to.equal(null);
    expect(r3).to.equal("aaa");
    expect(r4).to.deep.equal([1, "aaa"]);
    expect(r5).to.equal(123);
    expect(r6).to.deep.equal({
      a: 1,
      b: "test",
      c: undefined
    });
    expect(r7).to.deep.equal({
      a: null,
      b: "x",
      c: undefined
    });
    expect(r8).to.be.instanceOf(Test);
    expect(r8).to.deep.equal(new Test(1, "3"));
    expect(r9).to.be.instanceOf(Dummy);
    expect(r9).to.deep.equal(new Dummy());
    expect(r10).to.be.instanceOf(Dummy);
    expect(r10).to.deep.equal({
      a: 1,
      b: 2,
      c: 3
    });
    expect(r11).to.deep.equal([
      "test",
      1,
      true,
      undefined,
      "externally_referenced_type: 0"
    ]);
    expect(r12).to.equal(2);
    expect(r13).to.equal('externally_referenced_type: "ext"');
  });

  it("can validate schema", function () {
    const schema = parseSchema(schemaStr, subSchema);
    expect(() =>
      parse(`D {a: "invalid", b: "aaa", c: 1 }`, schema, "/src/aaa/test.txjson")
    ).to.throw(
      'expected object with signature `object { "a": X, "b": string, "c": undefined }'
    );
    expect(() => parse(`X YYY`, schema)).to.throw('unknown type "YYY"');
    expect(() => parse(`Test(1, "2", 3)`, schema)).to.throw(
      "expected arguments with signature `[int, string]`"
    );
    expect(() => parse(`Dummy(1, "2", 3)`, schema)).to.throw(
      `expected arguments with signature \`[]\``
    );
    expect(() => parse(`Dummy...`, schema)).to.throw(
      "syntax error at 1:8, mismatched input '<EOF>' expecting '{'"
    );
    expect(() => parse(`Dummy... {}`)).to.throw('unknown prototype "Dummy"');
    expect(() => parse(`DoesNotExist(1, "2", 3)`, schema)).to.throw(
      'unknown class "DoesNotExist"'
    );
    expect(() => parse(`W 8`, schema)).to.throw(
      "expected: `number(1)|number(2)|number(3)`"
    );
  });

  it("can validate document root", function () {
    const schema = parseSchema(`
      schema {
        ':document': arrayOf int,
      }
    `);
    expect(parse(`[1, 2, 3]`, schema)).to.deep.eq([1, 2, 3]);
    expect(() => parse(`[1.2, 2, 3]`, schema)).to.throw(
      'non-integer value found for type "int"'
    );
    expect(() => parse(`{}`, schema)).to.throw(
      "expected array of type `int[]`"
    );
  });

  it("can validate a practical example", function () {
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
        deserializers: {
          Place: (acc) => {
            return {
              PLACE_DESERIALIZED: true,
              ...safeObjectFromEntries(
                acc.children.map((c) => [c.key!, c.value])
              )
            };
          }
        },
        classes: {
          Point: class Point {
            type = "Point";
            coordinates: [number, number];
            constructor(x: number, y: number) {
              this.coordinates = [x, y];
            }
          }
        }
      }),
      "places.schema.txson"
    );
    expect(parse(`[]`)).to.deep.eq([]);
    expect(() => parse(`{}`, schema)).to.throw(
      "expected array of type `Place[]`"
    );
    expect(() =>
      parse(
        `[{
           id: "1",
           cat: "parks_and_recreation",
           status: "published",
           tags: [],
        }]`,
        schema
      )
    ).to.throw(
      'in field "name": (1,1): missing field "name" of type: string'
    );
    expect(() =>
      parse(
        `[{
           id: "1",
           name: "The good place",
           cat: "parks_and_recreation",
           status: "invalid",
           tags: [],
        }]`,
        schema
      )
    ).to.throw(
      'expected: `string("published")|string("private")|string("hidden")`'
    );
    expect(() =>
      parse(
        `[{
           id: "1",
           name: "The good place",
           cat: "parks_and_recreation",
           status: "published",
           tags: "a",
        }]`,
        schema
      )
    ).to.throw(
      'in field "tags": (6,17): expected array of type `string[]`'
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
        }, {
           id: "1",
           name: "The good place",
           cat: "parks_and_recreation",
           status: "private",
           tags: [],
        }]`,
        schema
      )
    ).to.deep.eq([
      {
        PLACE_DESERIALIZED: true,
        id: 0,
        name: "The good place",
        cat: "accomodation",
        status: "published",
        description: null,
        coords: {
          type: "Point",
          coordinates: [10, 10]
        },
        address: "123 Afterlife St.",
        tags: ["great amenities", "free wifi"]
      },
      {
        PLACE_DESERIALIZED: true,
        id: "1",
        name: "The good place",
        cat: "parks_and_recreation",
        status: "private",
        tags: []
      }
    ]);
  });

  it("errors on invalid schema", function () {
    expect(() =>
      parseSchema(`schema []`, undefined, "test.schema.txjson")
    ).to.throw(
      // eslint-disable-next-line max-len
      "test.schema.txjson(1,0): error in expression `schema []`: invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`"
    );
    expect(() => parseSchema(`{}`, undefined)).to.throw(
      "invalid input, document root must be of type `schema`"
    );
    expect(() => parseSchema(`schema undefined`, undefined)).to.throw(
      "invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`"
    );
    expect(() => parseSchema(`schema 1`, undefined)).to.throw(
      "invalid schema: expected an object with a signature of `schema { [typeName]: type, ... }`"
    );
    expect(() => parseSchema(`schema {x: [maybe int]}`, undefined)).to.throw(
      `unexpected array literal`
    );
    expect(() => parseSchema(`[schema {x: maybe null}]`, undefined)).to.throw(
      "nested schemas are not supported"
    );
    expect(() =>
      parseSchema(`schema { x: schema {x: int} }`, undefined)
    ).to.throw("nested schemas are not supported");
    expect(() => parseSchema(`[schema {x: {a: int}}]`, undefined)).to.throw(
      "unexpected object literal"
    );
    expect(() => parseSchema(`schema { x: class 1 }`, undefined)).to.throw(
      "class only accepts an optional array of arguments"
    );
    expect(() => parseSchema(`schema { x: proto 1 }`, undefined)).to.throw(
      "proto only accepts an optional key-value mapping"
    );
    expect(() => parseSchema(`schema { x: class {} }`, undefined)).to.throw(
      "class only accepts an optional array of arguments"
    );
    expect(() =>
      parseSchema(`schema { x: arrayOf class [] }`, undefined)
    ).to.throw(
      "classes may only be defined at the schema level or as part of a schema-level `oneOf` clause"
    );
    expect(() =>
      parseSchema(`schema { x: oneOf [class [], int] }`, undefined)
    ).to.throw(
      'unexpected "int" in `oneOf [class, ...]`, expected: class|proto|object'
    );
    expect(() =>
      parseSchema(`schema { ':document': class }`, undefined)
    ).to.throw("invalid class name");
    expect(() =>
      parseSchema(`schema { x: arrayOf proto {} }`, undefined)
    ).to.throw(
      "prototypes may only be defined at the schema level or as part of a schema-level `oneOf` clause"
    );
    expect(() =>
      parseSchema(`schema { x: oneOf [proto {}, int] }`, undefined)
    ).to.throw(
      'unexpected "int" in `oneOf [proto, ...]`, expected: class|proto|object'
    );
    expect(() =>
      parseSchema(`schema { ':document': proto {} }`, undefined)
    ).to.throw("invalid class name");
  });
  it("complex", function () {
    const schema = parseSchema(
      `
    schema {
      ':document': arrayOf TestCase,
      TestCase: oneOf [TestSQL, TestExpr],
      TestCaseConfig: object,
      TestSQL: object {
        mode: maybe oneOf ['lax', 'strict'],
        description: string,
        disable: maybe boolean,
        config: maybe TestCaseConfig,
        query: string,
        columns: maybe arrayOf oneOf [string, null],
        expressions: maybe arrayOf oneOf [string, null],
        normalized: maybe arrayOf oneOf [string, null],
        canonical: maybe arrayOf oneOf [string, null],
        results: maybe arrayOf oneOf [ANY, null],
        parse_error: maybe boolean,
      },
      TestExpr: object {
        mode: 'spreadsheet',
        description: string,
        disable: maybe boolean,
        config: maybe TestCaseConfig,
        query: oneOf [string, arrayOf string],
        expressions: maybe oneOf [string, arrayOf oneOf [string, null]],
        normalized: maybe oneOf [string, arrayOf oneOf [string, null]],
        canonical: maybe oneOf [string, arrayOf oneOf [string, null]],
        results: maybe oneOf [arrayOf oneOf [ANY, null], oneOf [ANY, null]],
        parse_error: maybe oneOf [boolean, arrayOf oneOf [boolean, null]],
      },
      TYPEID: string,
      NULL: oneOf [undefined, TYPEID],
      UNDEFINED: undefined,
      INT: string,
      UINT: INT,
      INT8: INT,
      INT16: INT,
      INT32: INT,
      INT64: INT,
      UINT8: INT,
      UINT16: INT,
      UINT32: INT,
      UINT64: INT,
      FLOAT32: oneOf [float, string],
      FLOAT: oneOf [float, string],
      STRING: oneOf [
        string,
        arrayOf [string, int],
      ],
      DECIMAL: oneOf [
        string,
        arrayOf [string, int, int]
      ],
      TIME: string,
      DATE: string,
      DATETIME: string,
      TIMESTAMP: string,
      JSON: string,
      BYTES: oneOf [
        arrayOf int,
        string,
      ],
      GEO: string,
      BOOL: bool,
      INTERVAL: oneOf [string, float],
      ANY: oneOf [
        BOOL,
        INT,
        FLOAT,
        DECIMAL,
        JSON,
        BYTES,
        GEO,
        STRING,
        TIME,
        DATE,
        DATETIME,
        TIMESTAMP,
        INTERVAL,
        UNDEFINED,
        STRUCT,
        NULL,
      ],
      VARIANT: oneOf [
        ANY,
        object {
          __type: string,
          __value: any,
        },
        arrayOf oneOf [
          ANY,
          object {
          __type: string,
          __value: any,
        }]
      ],
      STRUCT: object,
      Date: string,
      ValueError: string,
      ErrorNode:
        arrayOf object {
          type: string,
          code: string,
          level: string,
          location: object {
            start: int,
            end: int,
          },
        }
    }`,
      createSchema({
        deserializers: {
          UNDEFINED: () => `UNDEFINED`,
          NULL: () => `NULL`,
          TYPEID: () => `TYPEID`,
          STRING: () => `STRING`,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          STRUCT: (acc) => ({ STRUCT: acc.children[0].value }),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          VARIANT: (acc) => ({ VARIANT: acc.children[0].value }),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          INTERVAL: (acc) => ({ INTERVAL: acc.children[0].value }),
          INT: (acc) => ({ INT: acc.rawValue }),
          ValueError: () => `ValueError`
        }
      })
    );
    const res = parse<object>(
      `[
      {
        "description": "Math",
        "mode": "spreadsheet",
        "query": [
          "abc",
          "cde"
        ],
        "results": [
          [
            VARIANT STRUCT {"x": INT "1", "y": INT "2"},
            NULL,
            VARIANT INTERVAL "P1M15D"
          ],
        ],
      }, {
        "description": "Math 2",
        "mode": "spreadsheet",
        "query": [
        ],
        "results": [
        ],
      }
    ]`,
      schema
    );
    expect(res).to.deep.equal([
      {
        description: "Math",
        mode: "spreadsheet",
        query: ["abc", "cde"],
        results: [
          [
            { VARIANT: { STRUCT: { x: { INT: "1" }, y: { INT: "2" } } } },
            "NULL",
            { VARIANT: { INTERVAL: "P1M15D" } }
          ]
        ]
      },
      {
        description: "Math 2",
        mode: "spreadsheet",
        query: [],
        results: []
      }
    ]);
  });
  it("misc", function () {
    expect(() =>
      parse(
        `X ["aaa", {"x": int 0, y: []}]`,
        parseSchema(`
      schema { X: arrayOf [string, oneOf [object, arrayOf object]] }
    `)
      )
    ).to.not.throw();
    parse(
      `X [Y "zz", Z 2]`,
      parseSchema(`
        schema { X: arrayOf oneOf [Y, Z], Y: string, Z: number }
    `)
    );
    expect(() =>
      parse(
        `X [Y "zz", Z 2]`,
        parseSchema(`
        schema { X: arrayOf oneOf [Y, Z], Y: string, Z: number }`)
      )
    ).to.not.throw();
    expect(
      parse(
        '[X 1, X "2"]',
        parseSchema(
          `schema {X: oneOf [int, string]}`,
          createSchema({
            deserializers: {
              X: () => "override"
            }
          })
        )
      )
    ).to.deep.equal(["override", "override"]);
    expect(
      parse(
        '[X [1, "2"], X [2, "3"], Y [3, "4"]]',
        parseSchema(
          `schema {X: arrayOf [int, string], Y: X}`,
          createSchema({
            deserializers: {
              Y: () => "override"
            }
          })
        )
      )
    ).to.deep.equal([[1, "2"], [2, "3"], "override"]);
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
            deserializers: {}
          })
        )
      )
    ).to.deep.equal([
      "STRUCT(x INTEGER, y INTEGER)",
      {
        x: "1",
        y: "2"
      }
    ]);
  });
  it("misc 2", function () {
    expect(
      parse(
        `[
          variant int 1,
          variant string "x",
          variant X 0,
          variant Y(),
          variant C [X 1, X "a", { o: X 1, p: int 12, q: 12.2 }]
        ]`,
        parseSchema(
          `schema {
            Y: class,
            X: oneOf [int, string, boolean],
            C: arrayOf [int, string, object],
            any: oneOf [bigint, boolean, float, Y, C, X],
            variant: any,
          }`,
          createSchema({
            deserializers: {
              variant: (acc) =>
                `variant ${JSON.stringify(acc.children[0].value)}`,
              // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
              c: (acc) => `${acc.children[0].value}`,
              X: () => "X"
            },
            classes: {
              Y: class Y {
                readonly [Symbol.toStringTag] = "Y";
              }
            }
          })
        )
      )
    ).to.deep.equal([
      "variant 1",
      'variant "x"',
      'variant "X"',
      "variant {}",
      'variant ["X","X",{"o":"X","p":12,"q":12.2}]'
    ]);
  });
  it("misc 3", function () {
    expect(() =>
      parse(
        `X [Y 0, Z 0]`,
        parseSchema(
          `schema {
            X: arrayOf oneOf [Y, Z],
            Y: int,
            Z: int
          }`,
          createSchema({
            deserializers: {
              Y: () => "Y",
              Z: () => "Z"
            }
          })
        )
      )
    ).to.not.throw();
    expect(() =>
      parse(
        `X [Y 0, Z 0]`,
        parseSchema(
          `schema {
            X: arrayOf oneOf [Y, Z],
            Y: int,
            Z: int
          }`,
          createSchema({
            deserializers: {
              Y: () => "Y"
            }
          })
        )
      )
    ).to.not.throw();
    expect(() =>
      parse(
        `X [Y 0, Z 0]`,
        parseSchema(
          `schema {
            X: arrayOf oneOf [Y, Z],
            Y: int,
            Z: int
          }`,
          createSchema({
            deserializers: {
              Z: () => "Z"
            }
          })
        )
      )
    ).to.not.throw();
  });
  it("misc 4", function () {
    expect(() =>
      parse(
        `X [Y 0, Z 0]`,
        parseSchema(
          `schema {
            X: arrayOf oneOf [Y, Z],
            Y: int,
            Z: int
          }`,
          createSchema({
            deserializers: {
              Y: () => "Y",
              Z: () => "Z"
            }
          })
        )
      )
    ).to.not.throw();
    expect(() =>
      parse(
        `X [Y 0, Z 0]`,
        parseSchema(
          `schema {
            X: arrayOf oneOf [Y, Z],
            Y: int,
            Z: int
          }`,
          createSchema({
            deserializers: {
              Y: () => "Y"
            }
          })
        )
      )
    ).to.not.throw();
    expect(() =>
      parse(
        `X [Y 0, Z 0]`,
        parseSchema(
          `schema {
            X: arrayOf oneOf [Y, Z],
            Y: int,
            Z: int
          }`,
          createSchema({
            deserializers: {
              Z: () => "Z"
            }
          })
        )
      )
    ).to.not.throw();
  });
});
