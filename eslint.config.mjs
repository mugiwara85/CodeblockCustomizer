import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["node_modules", "dist", "main.js", "esbuild.config.mjs", "version-bump.mjs", "tests"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    // the Obsidian scorecard also reports unused function parameters (unless they start with "_")
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { args: "all", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    // the scanner (obsidianmd/obsidian-workflows) uses an older eslint-plugin-obsidianmd, which runs these two
    // without the newer version's exceptions (Setting components counted as promises, display() below minAppVersion 1.13)
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-deprecated": ["warn", { allow: [] }],
    },
  },
  {
    // the dynamic settings CSS needs a <style> tag because PDF export ignores adoptedStyleSheets; to make CI passes it is kept as a warning
    files: ["src/Utils.ts"],
    rules: {
      "obsidianmd/no-forbidden-elements": "warn",
    },
  },
]);
