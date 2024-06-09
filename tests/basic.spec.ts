import {use} from 'chai';
import equalBytes from 'chai-bytes';

import {createSchema, parse} from '../src/index.ts';

const {expect} = use(equalBytes);

describe('TxJSON parser', function(this: Mocha.Suite) {
  this.timeout(Infinity);
  it('can parse primitives', function() {
    expect(parse('undefined')).to.equal(undefined);
    expect(parse('null')).to.equal(null);
    expect(parse('int 1')).to.equal(1);
    expect(parse('float 123.5')).to.equal(123.5);
    expect(parse('bigint 1')).to.equal(1n);
    expect(parse('3n')).to.equal(3n);
    expect(parse('string "1"')).to.equal('1');
    expect(parse('/\\d+/g')).to.deep.equal(/\d+/g);
    expect(parse('boolean true')).to.equal(true);
    expect(parse('array [int 1, int 2, int 3]')).to.deep.equal([1, 2, 3]);
    expect(parse('Uint8Array()')).to.deep.equal(new Uint8Array([]));
    expect(parse('Uint8Array([1, 2, 3])')).to.deep.equal(
      new Uint8Array([1, 2, 3]),
    );
    expect(parse('Uint8ClampedArray()')).to.deep.equal(
      new Uint8ClampedArray([]),
    );
    expect(parse('Uint8ClampedArray([0, 255])')).to.deep.equal(
      new Uint8ClampedArray([0, 255]),
    );
    expect(parse('object {a: int 1, b: int 2, c: bigint "3"}')).to.deep.equal({
      a: 1,
      b: 2,
      c: 3n,
    });
  });
  it('rejects unknown types', function() {
    expect(() => parse(`unknown 0`)).to.throw(
      '(1,0): error in expression `unknown 0`: unknown type "unknown"',
    );
  });
  it('can parse nested objects', function() {
    const value = parse(`{
      "str": "string a\
b\
c",
      'n': 1,
      bool: true,
      arr: [1, 2, 3],
      obj: {a: "\u1234z", b: [0, 0, 7], c: bigint "10000" },
      nul: null,
      bint: bigint "1000000000000000000000000000000",
      bint2: 1000000000000000000000000000000n,
      "\u1234z": "vvvv",
      rx: /\\d+/gi
    }`);
    expect(value.str).to.equal('string abc');
    expect(value.n).to.equal(1);
    expect(value.bool).to.equal(true);
    expect(value.arr).to.deep.equal([1, 2, 3]);
    expect(value.obj).to.deep.equal({
      a: '\u1234z',
      b: [0, 0, 7],
      c: BigInt('10000'),
    });
    expect(value.nul).to.equal(null);
    expect(value.bint).to.equal(BigInt('1000000000000000000000000000000'));
    expect(value.bint2).to.equal(BigInt('1000000000000000000000000000000'));
    expect(value['\u1234z']).to.equal('vvvv');
    expect(value.rx).to.be.instanceOf(RegExp);
    expect(value.rx.source).to.equal('\\d+');
    expect(value.rx.flags).to.equal('gi');
  });
  it('can parse typed arrays', function() {
    const value = parse(`Uint8Array([1, 2, 3])`);
    expect(value).to.equalBytes([1, 2, 3]);
  });
  it('can parse custom prototype construction', function() {
    class Test {
      a!: number;
    }
    const value = parse(
      `Test... { a: 100 }`,
      createSchema({
        prototypes: {Test},
      }),
    );
    expect(value).to.be.instanceOf(Test);
    expect(value.a).to.equal(100);
  });
  it('can trigger deserialisers', function() {
    const ctx = createSchema({
      deserializers: {
        Empty: (acc) => `Empty is ${acc.children[0].value}`,
      },
    });
    const value = parse(`Empty`, ctx);
    expect(value).to.equal(`Empty is undefined`);
  });
  it('can forward constructor calls', function() {
    class Test2 {
      constructor(public a: number, public b: string) {}
    }
    class Test3 {
      values: any[];
      constructor(...values: any[]) {
        this.values = values;
      }
    }
    const [v1, v2, v3] = parse(
      `[Test2(123, "aaa"), Test2(0), Test3('a', 'b', 'c')]`,
      createSchema({
        classes: {Test2, Test3},
      }),
    );
    expect(v1).to.be.instanceOf(Test2);
    expect(v1.a).to.equal(123);
    expect(v1.b).to.equal('aaa');
    expect(v2.a).to.equal(0);
    expect(v2.b).to.equal(undefined);
    expect(v3).to.be.instanceOf(Test3);
    expect(v3.values).to.deep.equal(['a', 'b', 'c']);
  });
  it('errors on invalid literals', function() {
    expect(() => parse(`int 123.5`)).to.throw(
      '(1,0): error in expression `int 123.5`: non-integer value found for type "int"',
    );
    expect(() => parse(`object 0`)).to.throw(
      '(1,0): error in expression `object 0`: expected "object", found "number"',
    );
    expect(() => parse(`null 0`)).to.throw(
      'syntax error at 1:5, extraneous input \'0\' expecting <EOF>',
    );
    expect(() => parse(`Test(0)`)).to.throw(
      '(1,0): error in expression `Test(0)`: unknown class "Test"',
    );
    expect(() => parse(`Test... {}`)).to.throw(
      '(1,0): error in expression `Test... {}`: unknown prototype "Test"',
    );
    expect(() => parse(`Test... 0`)).to.throw(
      'syntax error at 1:8, mismatched input \'0\' expecting \'{\'',
    );
    expect(() => parse(`object... {}`)).to.throw(
      '(1,0): error in expression `object... {}`: unknown prototype "object"',
    );
    expect(() => parse(`Uint8Array... {'0': 1}`)).to.throw(
      '(1,0): error in expression `Uint8Array... {\'0\': 1}`: unknown prototype "Uint8Array"',
    );
  });
});
