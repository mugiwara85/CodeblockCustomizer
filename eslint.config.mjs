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
]);
