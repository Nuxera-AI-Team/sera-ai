// ESLint 9 flat config, replacing the legacy .eslintrc.json.
//
// Mirrors what the eslintrc declared — eslint:recommended, the
// @typescript-eslint recommended set, and eslint-config-prettier last so
// formatting rules never fight Prettier — with browser + node globals, since
// this library runs in the browser but its build tooling runs in node.
//
// Only `src` is linted (see the lint script). `dist` is generated, and the
// `test/` Vite app and `scripts/` are outside the library surface.

import js from "@eslint/js";
import globals from "globals";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["dist/**", "test/**", "scripts/**", "node_modules/**"] },
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The packaged workers are plain JS and run in a worker scope, not a window.
    // The old `--ext .ts,.tsx` skipped them entirely; they are linted here.
    files: ["src/workers/**/*.js"],
    languageOptions: {
      globals: { ...globals.worker },
    },
  },
  {
    // audio-processor.js is an AudioWorklet, whose scope is neither a window nor
    // a worker: these three globals are supplied by the AudioWorklet runtime.
    files: ["src/workers/audio-processor.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
      },
    },
  },
  {
    // A leading underscore marks a binding that has to exist but is deliberately
    // not read: a fixed callback signature we don't control, or a builder parked
    // for a caller that doesn't exist yet.
    //
    // The base rule and the TypeScript rule are configured separately and never
    // both at once — flat/eslint-recommended switches the base rule off for TS,
    // where it misreads type-only declarations as unused.
    files: ["src/workers/**/*.js"],
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}", "src/workers/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
];
