grammar TxJSON;

options {
  tokenVocab = Lexer;
}

@header {
  // @ts-nocheck
}

root: value? EOF;

obj: OpenBrace pair (Comma pair)* Comma? CloseBrace | OpenBrace CloseBrace;

pair: key Colon value;

key: STRING | IDENTIFIER | TRUE | FALSE | UNDEFINED | NULL | NUMERIC_LITERAL;

call: OpenParen value (Comma value)* Comma? CloseParen | OpenParen CloseParen;

arr
  : OpenBracket value (Comma value)* Comma? CloseBracket
  | OpenBracket CloseBracket
;

number: SIGN? (NUMERIC_LITERAL | NUMBER);

bignumber: SIGN? BINT;

typedValue
  : IDENTIFIER value?     # tValue
  | IDENTIFIER Spread obj # tProto
  | IDENTIFIER call       # tCtor
;

value: basicValue | typedValue;

basicValue
  : UNDEFINED                # tUndefined
  | TRUE                     # tBoolean
  | FALSE                    # tBoolean
  | NULL                     # tNull
  | BQUOTE_STRING            # tBQuoteString
  | STRING                   # tString
  | bignumber                # tBigInt
  | number                   # tNumber
  | obj                      # tObject
  | arr                      # tArray
  | RegularExpressionLiteral # tRegExp
;