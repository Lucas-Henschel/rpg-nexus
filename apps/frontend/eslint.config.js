import js from "@eslint/js";
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
    languageOptions: {
      globals: globals.browser,
    },
    // Vêm depois do prettier para não serem desligadas por ele. Compatíveis com a formatação.
    rules: {
      // Todo if/else/for com chaves: nada de `if (x) return y;` numa linha só.
      curly: ["error", "all"],
      // Ternário dentro de ternário vira if ou um objeto de consulta.
      "no-nested-ternary": "error",
    },
  },
]);
