import {CharStream, CommonTokenStream, ParseTreeWalker} from "antlr4ng";
import {Lexer} from "./parser/Lexer";

import {TxListener} from "./ast";
import {TxJSONParser} from "./parser/TxJSONParser";
import type {ISchema} from "./schema";
import {Schema, createSchemaOfSchema, defaultSchema} from "./schema";

export function parseSchema(
  document: string,
  baseSchema: Partial<Schema> = defaultSchema,
  schemaFileName?: string
): Schema {
  return parse(document, createSchemaOfSchema(baseSchema), schemaFileName);
}

export function parse<T = unknown>(
  document: string,
  schema: Partial<ISchema> = defaultSchema,
  fileName?: string
): T {
  const activeSchema = new Schema(schema);
  activeSchema.meta.fileName = fileName ?? schema.meta?.fileName;
  const stream = CharStream.fromString(document);
  const lexer = new Lexer(stream);
  const tokens = new CommonTokenStream(lexer);
  const parser = new TxJSONParser(tokens);
  const listener = new TxListener(parser, activeSchema);
  const walker = new ParseTreeWalker();
  parser.removeErrorListeners();
  parser.removeParseListeners();
  parser.addErrorListener({
    syntaxError: <T>(
      _recognizer: any,
      _offendingSymbol: T | undefined,
      line: number,
      charPositionInLine: number,
      msg: string
    ) => {
      throw new Error(
        `syntax error at ${
          schema.meta?.fileName ? schema.meta.fileName + ":" : ""
        }${String(line)}:${String(charPositionInLine)}, ${msg}`
      );
    },
    reportAmbiguity: () => {
      /**
       * Do nothing
       */
    },
    reportContextSensitivity: () => {
      /**
       * Do nothing
       */
    },
    reportAttemptingFullContext: () => {
      /**
       * Do nothing
       */
    }
  });
  walker.walk(listener, parser.root());
  activeSchema.meta.root = listener.root;
  return listener.root.value;
}

export type {
  ActiveSchema, Deserializer,
  RawAccessor, Validator, ValueAccessor
} from "./schema";

export {
  Schema,
  createSchema
} from "./schema";
