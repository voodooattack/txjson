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

typedValue
  : IDENTIFIER value?  # tValue
  | IDENTIFIER Spread obj # tProto
  | IDENTIFIER call    # tCtor
;

basicValue
  : UNDEFINED                # tUndefined
  | TRUE                     # tBoolean
  | FALSE                    # tBoolean
  | NULL                     # tNull
  | STRING                   # tString
  | number                   # tNumber
  | bignumber                # tBigInt
  | obj                      # tObject
  | arr                      # tArray
  | RegularExpressionLiteral # tRegExp
;

value: basicValue | typedValue;

call: OpenParen value (Comma value)* Comma? CloseParen | OpenParen CloseParen;

arr
  : OpenBracket value (Comma value)* Comma? CloseBracket
  | OpenBracket CloseBracket
;

number: SIGN? (NUMERIC_LITERAL | NUMBER);

bignumber: SIGN? BINT;