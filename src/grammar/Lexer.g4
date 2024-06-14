
// Lexer

lexer grammar Lexer;

fragment RegularExpressionBody
  : RegularExpressionFirstChar RegularExpressionChar*
  ;

fragment RegularExpressionFlags: IDENTIFIER_PART*;

fragment RegularExpressionFirstChar
  : ~[\r\n\u2028\u2029*\\/[]
  | RegularExpressionBackslashSequence
  | RegularExpressionClass
  ;

fragment RegularExpressionChar
  : ~[\r\n\u2028\u2029\\/[]
  | RegularExpressionBackslashSequence
  | RegularExpressionClass
  ;

fragment RegularExpressionNonTerminator: ~[\r\n\u2028\u2029];

fragment RegularExpressionBackslashSequence
  : '\\' RegularExpressionNonTerminator
  ;

fragment RegularExpressionClass
  : '[' RegularExpressionClassChar* ']'
  ;

fragment RegularExpressionClassChar
  : ~[\r\n\u2028\u2029\]\\]
  | RegularExpressionBackslashSequence
  ;

RegularExpressionLiteral
  : Slash RegularExpressionBody Slash RegularExpressionFlags
  ;

SINGLE_LINE_COMMENT: '//' .*? (NEWLINE | EOF) -> skip;

MULTI_LINE_COMMENT: '/*' .*? '*/' -> skip;

STRING
  : '"' DOUBLE_QUOTE_CHAR* '"'
  | '\'' SINGLE_QUOTE_CHAR* '\''
  ;

Colon: ':';
OpenBrace: '{';
CloseBrace: '}';
OpenParen: '(';
CloseParen: ')';
OpenBracket: '[';
CloseBracket: ']';
Comma: ',';
Spread: '...';
Slash: '/';

TRUE: 'true';
FALSE: 'false';
UNDEFINED: 'undefined';
NULL: 'null';
N: 'n';

fragment DOUBLE_QUOTE_CHAR: ~["\\\r\n] | ESCAPE_SEQUENCE;

fragment SINGLE_QUOTE_CHAR: ~['\\\r\n] | ESCAPE_SEQUENCE;

fragment ESCAPE_SEQUENCE
  : '\\' (
    NEWLINE
    | UNICODE_SEQUENCE // \u1234
    | ['"\\/bfnrtv] // single escape char
    | ~['"\\bfnrtv0-9xu\r\n] // non escape char
    | '0' // \0
    | 'x' HEX HEX // \x3a
  )
  ;

NUMBER
  : INT (
    '.' [0-9]*
  )? EXP? // +1.e2, 1234, 1234.5
  | '.' [0-9]+ EXP? // -.2e3
  | '0' [xX] HEX+ // 0x12345678
  ;

NUMERIC_LITERAL: 'Infinity' | 'NaN';

SIGN: '+' | '-';

fragment HEX: [0-9a-fA-F];

fragment INT: '0' | [1-9] [0-9]*;

BINT: '0n' | [1-9] [0-9]* N;

fragment EXP: [Ee] SIGN? [0-9]*;

IDENTIFIER: IDENTIFIER_START IDENTIFIER_PART*;

fragment IDENTIFIER_START
  : [\p{L}]
  | '$'
  | '_'
  | '\\' UNICODE_SEQUENCE
  ;

fragment IDENTIFIER_PART
  : IDENTIFIER_START
  | [\p{M}]
  | [\p{N}]
  | [\p{Pc}]
  | '\u200C'
  | '\u200D'
  ;

fragment UNICODE_SEQUENCE: 'u' HEX HEX HEX HEX;

fragment NEWLINE: '\r\n' | [\r\n\u2028\u2029];

WS: [ \t\n\r\u00A0\uFEFF\u2003]+ -> channel(HIDDEN);

// LEXER: Silence is golden
ErrorCharacter: .;
