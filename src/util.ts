import {ParserRuleContext, type BufferedTokenStream, type TerminalNode, type Token} from 'antlr4ng';
import type {RawAccessor} from './schema.ts';

export function getExpression(acc: RawAccessor<any>) {
  const ctx = acc.rule as ParserRuleContext | TerminalNode;
  const [startTok, endTok]: [Token|null, Token|null] =
    ctx instanceof ParserRuleContext ?
      [acc.rule.start, acc.rule.stop!] :
      [ctx.symbol, ctx.symbol];
  const stream = acc.schema.parser.inputStream as BufferedTokenStream;
  return stream.getTextFromRange(startTok, endTok);
}

/* istanbul ignore next */
export function getLoc(acc: RawAccessor<any>, simple = false): string {
  const ctx = acc.rule as ParserRuleContext | TerminalNode;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  let loc: string = simple ? '' : acc.schema.meta.fileName ?? '';
  if (ctx instanceof ParserRuleContext) {
    loc += `(${String(ctx.start?.line)},${String(ctx.start?.column)})`;
  } else {
    loc += `(${String(ctx.symbol.line)},${String(ctx.symbol.column)})`;
  }
  return loc;
}

export class ValueError extends Error {
  constructor(
    public acc: RawAccessor<any>,
    private msg: string,
    public simplified = false,
  ) {
    super();
  }
  get message() {
    if (this.simplified) {
      return `${getLoc(this.acc, true)}: ${this.msg}`;
    }
    return `${getLoc(this.acc)}: error in expression \`${indent(getExpression(
      this.acc,
    ), 0)}\`: ${this.msg}`;
  }
}

export function safeObjectFromEntries<T extends object = object>(
  entries: [PropertyKey, any][],
  proto: object|null = null,
): T {
  return Object.assign(
    Object.create(proto),
    Object.fromEntries<T[any]>(entries),
  );
}

export function indent(str: string, level = 0, reindent?: boolean) {
  return str.replace(reindent ? /\n\s*/g : /\n/g, '\n' + '  '.repeat(level));
}

export function isValidIdent(str: string) {
  return /^[$_\w\d][\w\d_$]*$/.test(str);
}
