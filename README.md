[![npm version](https://badge.fury.io/js/txjson.svg)](https://badge.fury.io/js/txjson)

# TxJSON

> An extension of JSON5 with rich inline type information.

TxJSON allows you to define typed values and define deserialisers for said values at runtime.

Syntax:

```js
{
  x: date "2001-01-01", // it can handle custom deserializers!
  y: 123n, // it can handle `BigInt` out of the box!
  z: /^I\sCAN\sPARSE\sREGEX$/im, // ...and also regular expressions!
  backquote: `Hello
World!`, // multi-line template strings are supported! (sans placeholders)
  w: undefined, // ...and even `undefined`!
}
```

Perfect for configuration files and programmatic generation of tests!

### Schema

Perhaps, the best example of a TxJSON document is a TxJSON schema:

```js
schema {
  /// Use `:document` to restrict the type of a document's root.
  ":document": arrayOf Place,
  // a literal object signature
  Place: object {
    // `id` can be a string or a number
    id: oneOf [string, number],
    name: string,
    cat: Category,
    // `maybe` makes the following type optional (e.g can be `undefined` or `null`)
    description: maybe string,
    coords: maybe oneOf [arrayOf Point, Point],
    region: arrayOf Point,
    address: maybe string,
    phone: maybe string,
    // `tags` is a dynamic string array of any length.
    tags: maybe arrayOf string,
    // You can pass literal values to match against. This can be used to define enums with `oneOf`!
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
      bbox: maybe arrayOf [number, number, number, number], // `maybe` makes this field optional
    },
    // A class version of the same object.
    class [number, number]
  ],
}
```

---

## Prerequisites

This project requires NodeJS (version 8 or later) and NPM.
[Node](http://nodejs.org/) and [NPM](https://npmjs.org/) are really easy to install.
To make sure you have them available on your machine,
try running the following command.

```sh
$ npm -v && node -v
6.4.1
v8.16.0
```

During development, you must have a version of Java installed, this is required by `antlr4ng` for use in generating the parser.

---

## Table of contents

- [TxJSON](#TxJSON)
  - [Prerequisites](#prerequisites)
  - [Table of contents](#table-of-contents)
  - [Getting Started](#getting-started)
  - [Installation](#installation)
  - [API](#api)
    - [parse](#parse)
    - [parseSchema](#parseSchema)
    - [createSchema](#createSchema)
  - [Contributing](#contributing)
  - [Versioning](#versioning)
  - [Authors](#authors)
  - [License](#license)

---

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. See deployment for notes on how to deploy the project on a live system.

---

## Installation

**BEFORE YOU INSTALL:** please read the [prerequisites](#prerequisites)

To install and set up the library, run:

```sh
$ npm install txjson
```

Or if you prefer using Yarn:

```sh
$ yarn add txjson
```

---

## API

### parse

```ts
function parse<T>(
  input: string,
  schema?: Partial<ISchema>,
  fileName?: string
): T
```

Parses a TxJSON file and returns a JavaScript value.

#### Arguments:

`input: string`: The input to be parsed.

`schema?: Partial<ISchema>`

| Field | Default value | Description |
| --- | --- | --- |
| `deserializers` | {...} | A mapping of `[name]: Deserializer` pairs |
| `validators` | {...} | A mapping of `[name]: Validator` pairs |
| `classes` | {...} | A mapping of user classes, constructible using the constructor syntax: `MyClass(x, y, z)` |
| `prototypes` | {...} | A mapping of user classes, constructible using the prototype assignment syntax: `MyClass... { field1: "value", ... }` |
| `preprocessors` | {...} | A mapping of user preprocessors, these will run before any validation occurs. |
| `meta` | {...} | A dictionary to store user metadata. |

If no schema is supplied, this function will use the [default schema](#createSchema).

`fileName?: string`: An optional file name to include in error messages.

Example:

```ts
  import {parse} from "txjson";

  parse(`12`);          // ok
  parse(`int 12`);      // ok
  parse(`float 12.3`);  // ok
  parse(`int 12.3`);    // error!
```

### parseSchema

```ts
function parseSchema(
  document: string,
  baseSchema?: Schema,
  schemaFileName?: string
): Schema
```

Parses a schema document.

#### Arguments:

`definition: string`: The schema string.

`baseSchema?: Schema`: the original schema to extend/apply these definitions to. (optional)

`schemaFileName?: string`: An optional file name to include in error messages.

Example:
```ts
  import {parse, parseSchema} from "txjson";

  const schema = parseSchema(`
    schema {
      intOrBigInt: oneOf [int, bigint],
      optionalInt: maybe int,
      strOrNumber: oneOf [string, number],
      date: strOrNumber,
      MyClass: class [string, number],
      MyProto: proto {
        a: string,
        b: number,
      },
    }
  `, {
    classes: {
      MyClass: class MyClass {
        constructor(public a: string, public b: number) {}
      }
    },
    prototypes: {
      MyProto: class MyProto {
        public a: string;
        public b: number;
      }
    },
    deserializers: {
      'Date': (acc: ValueAccessor) => new Date(acc.rawValue),
    }
  })

  parse(`intOrBigInt 1`) // ok
  parse(`intOrBigInt int 1`) // ok
  parse(`intOrBigInt bigint "123"`) // ok
  parse(`intOrBigInt 123n`) // ok
  parse(`intOrBigInt 13.3`) // error!

  parse(`optionalInt null`) // ok
  parse(`optionalInt 0`) // ok
  parse(`optionalInt "x"`) // error!

  parse(`date 0`) // ok!
  parse(`date "2001-01-01"`) // ok!
  parse(`date 123n`) // error!

  parse(`MyClass("a", 2)`) // ok!
  parse(`MyClass("a")`) // error, missing argument!
  parse(`MyClass(1, 2)`) // error, invalid argument!
  parse(`MyClass... {a: "a", b: 2}`) // error, not a proto!

  parse(`MyProto... {a: "a", b: 2}`) // ok!
  parse(`MyProto... {a: "a", b: 2, c: 212}`) // error, extra field!
  parse(`MyProto... {a: 1, b: "a"}`) // error, invalid field!
  parse(`MyProto... {a: 1}`) // error, missing field!
  parse(`MyProto("a", 2)`) // error, constructor call on proto is not supported!

```

### createSchema

```ts
function createSchema(
  overrides?: Partial<ISchema>
): Schema
```

Creates a new schema with default types. (e.g `int`, `bigint`, `UInt8Array`, ...)

#### Arguments:

`overrides`: (optional) Pass another schema to override the defaults.

---

## Contributing

1.  Fork it!
2.  Create your feature branch: `git checkout -b my-new-feature`
3.  Add your changes: `git add .`
4.  Commit your changes: `git commit -am 'Add some feature'`
5.  Push to the branch: `git push origin my-new-feature`
6.  Submit a pull request :sunglasses:

---

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/voodooattack/txjson/tags).

---
## Authors

* **Abdullah Ali** - *Initial work* - [GitHub](https://github.com/voodooattack)

See also the list of [contributors](https://github.com/your/project/contributors) who participated in this project.

---
## License

[MIT License](https://andreasonny.mit-license.org/2019) © Abdullah Ali
