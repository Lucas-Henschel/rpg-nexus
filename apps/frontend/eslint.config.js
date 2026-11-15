import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Desliga as regras de estilo do ESLint: a formatação fica com o Prettier.
      prettier,
    ],
    plugins: { "@stylistic": stylistic },
    languageOptions: {
      globals: globals.browser,
    },
    // Vêm depois do prettier para não serem desligadas por ele. Compatíveis com a formatação.
    rules: {
      // Todo if/else/for com chaves: nada de `if (x) return y;` numa linha só.
      curly: ["error", "all"],
      // Ternário dentro de ternário vira if ou um objeto de consulta.
      "no-nested-ternary": "error",
      // Linha em branco depois de cada bloco (if, for, switch...) e antes de return, como em
      // app/App.tsx. Uma variável e o if que testa ela continuam juntos.
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "block-like", next: "*" },
        { blankLine: "always", prev: "*", next: "return" },
      ],
    },
  },
]);
