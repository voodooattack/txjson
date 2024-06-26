import {ParserRuleContext, type BufferedTokenStream, type TerminalNode, type Token} from 'antlr4ng';
import type {RawAccessor} from './schema.ts';

export function getExpression(acc: RawAccessor) {
  const ctx = acc.rule as ParserRuleContext | TerminalNode;
  const [startTok, endTok]: [Token|null, Token|null] =
    ctx instanceof ParserRuleContext ?
      [acc.rule.start, acc.rule.stop as Token] :
      [ctx.symbol, ctx.symbol];
  const stream = acc.schema.parser.inputStream as BufferedTokenStream;
  return stream.getTextFromRange(startTok, endTok);
}

/* istanbul ignore next */
export function getLoc(acc: RawAccessor, simple = false) {
  const ctx = acc.rule as ParserRuleContext | TerminalNode;
  let loc = simple ? '' : acc.schema.meta.fileName ?? '';
  if (ctx instanceof ParserRuleContext) {
    loc += `(${ctx.start?.line},${ctx.start?.column})`;
  } else {
    loc += `(${ctx.symbol.line},${ctx.symbol.column})`;
  }
  return loc;
}

export class ValueError extends Error {
  constructor(
    public acc: RawAccessor,
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
  proto: any = null,
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
