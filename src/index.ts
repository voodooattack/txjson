import type {Recognizer} from 'antlr4ts';
import {CharStreams} from 'antlr4ts/CharStreams';
import {CommonTokenStream} from 'antlr4ts/CommonTokenStream';
import {ParseTreeWalker} from 'antlr4ts/tree';
import {TxJSONLexer} from './parser/TxJSONLexer';

import {TxListener} from './ast';
import {TxJSONParser} from './parser/TxJSONParser';
import type {ISchema} from './schema';
import {Schema, createSchemaOfSchema, defaultSchema} from './schema';

export function parseSchema(
  document: string,
  baseSchema: Partial<Schema> = defaultSchema,
  schemaFileName?: string,
): Schema {
  return parse(
    document,
    createSchemaOfSchema(baseSchema),
    schemaFileName,
  ) as Schema;
}

export function parse<T = any>(
  document: string,
  schema: Partial<ISchema> = defaultSchema,
  fileName?: string,
): T {
  const activeSchema = new Schema(schema);
  activeSchema.meta!.fileName = fileName ?? schema.meta?.fileName;
  const stream = CharStreams.fromString(document);
  const lexer = new TxJSONLexer(stream);
  const tokens = new CommonTokenStream(lexer);
  const parser = new TxJSONParser(tokens);
  const listener = new TxListener(parser, activeSchema);
  const walker = new ParseTreeWalker();
  parser.removeErrorListeners();
  parser.removeParseListeners();
  parser.addErrorListener({
    syntaxError: <T>(
      _recognizer: Recognizer<T, any>,
      _offendingSymbol: T | undefined,
      line: number,
      charPositionInLine: number,
      msg: string,
    ) => {
      throw new Error(
        `syntax error at ${
          schema.meta?.fileName ? schema.meta?.fileName + ':' : ''
        }${line}:${charPositionInLine}, ${msg}`,
      );
    },
  });
  walker.walk(listener, parser.root());
  activeSchema.meta.root = listener.root;
  return listener.root.value;
}

export {
  Schema,
  ValueAccessor,
  RawAccessor,
  ActiveSchema,
  Validator,
  Deserializer,
  createSchema,
} from './schema';
