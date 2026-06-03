// ESLint flat config (ESLint v9+). Replaces the legacy .eslintrc.json.
// ONEXUS is plain browser JS loaded via <script> tags (no modules, no build step),
// so files are treated as scripts with browser globals plus a few app/library globals.
"use strict";

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // App globals (intentionally global by design — see CLAUDE.md)
        cy: "readonly",
        ONEXUS: "readonly",
        cytoscape: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { vars: "all", args: "none", ignoreRestSiblings: true }],
      eqeqeq: ["warn", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error", "debug", "info"] }],
      "no-undef": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      // Empty catch is the approved safe-fail pattern for optional/plugin integrations.
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Harmless regex escapes — surface as warnings, don't fail the build.
      "no-useless-escape": "warn",
    },
  },
  {
    // Dev-only tools may use looser patterns
    files: ["src/dev/**/*.js"],
    rules: { "no-unused-vars": "off" },
  },
];
