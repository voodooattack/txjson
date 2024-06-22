import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

import eslintPluginComments from "eslint-plugin-eslint-comments";
import * as eslintPluginOnlyWarn from "eslint-plugin-only-warn";
import * as eslintPluginPrettier from "eslint-plugin-prettier";
import eslintPluginSimpleSortImports from "eslint-plugin-simple-import-sort";

const myConfig = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    globals: {
      ...globals.browser,
    },
    parserOptions: {
      project: ["tsconfig.json", "tsconfig.tests.json"],
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: {
    prettier: eslintPluginPrettier, // must be after all others, except for the only-warn plugin
    "only-warn": eslintPluginOnlyWarn, // must be very last so all plugins before can be turned into warnings!
    "eslint-comments": eslintPluginComments,
    "simple-import-sort": eslintPluginSimpleSortImports,
    prettier: eslintPluginPrettier, // must be after all others, except for the only-warn plugin
    "only-warn": eslintPluginOnlyWarn, // must be very last so all plugins before can be turned into warnings!
  },
  rules: {
    "max-len": ["warn", { code: 120 }],
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
    camelcase: "off",
    "no-unused-vars": "off",
    "space-before-function-paren": "off",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        vars: "local",
        args: "after-used",
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "no-throw-literal": "off",
    eqeqeq: 2,
    "no-irregular-whitespace": 2,
    "no-lonely-if": 1,
    "no-multiple-empty-lines": "error",
    "no-useless-call": 2,
    "no-useless-escape": 0,
    "no-empty": "error",
    "new-cap": "off",
    "comma-dangle": "off",
    "no-invalid-this": "off",
    "no-extra-boolean-cast": "off",
    "no-control-regex": "off",
    "@typescript-eslint/no-namespace": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-invalid-void-type": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unnecessary-condition": "off",
    "@typescript-eslint/ban-types": "off",
    "@typescript-eslint/no-invalid-this": "error",
    "spaced-comment": ["error", "always", { markers: ["/"] }],

    // #region temporary off
    "no-case-declarations": 0,
    "no-async-promise-executor": 0,
    "no-inner-declarations": 0,
    "no-constant-condition": 0,
    "no-unsafe-finally": 0,
    "no-prototype-builtins": 0,
    // #endregion temporary off

    // #region conflicted rules between ESLint recommended and TypeScript rules
    "no-undef": 0,
    "no-dupe-class-members": 0,
    "@typescript-eslint/no-dupe-class-members": 2,
    // https://typescript-eslint.io/rules/no-redeclare/
    "no-redeclare": 0,
    "@typescript-eslint/no-redeclare": 2,
    // #enredgion

    // #region code formatter related configs
    // these rules may be conflicted with prettier rules
    // and some rules are deprecated since ESLint v8.53.0
    indent: "off",
    quotes: "off",
    "brace-style": "off",
    "operator-linebreak": "off",
    "quote-props": "off",
    "object-curly-spacing": "off",
    // 'indent': ['error', 2],
    // #endregion

    "eslint-comments/no-unused-disable": "warn",
    ...eslintPluginPrettier.rules, // must be last!
  },
};

export default tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      myConfig,
    ],
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
  {
    files: ["./src/parser/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      myConfig,
    ],
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      indent: ["warn", 2],
      "no-tabs": 0,
      "no-empty": 0,
      "no-mixed-spaces-and-tabs": 0,
      "@typescript-eslint/no-unused-vars": "off",
      eqeqeq: 0,
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
  }
);
