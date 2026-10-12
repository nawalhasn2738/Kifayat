import expoConfig from "eslint-config-expo/flat.js";
import { defineConfig } from "eslint/config";

export default defineConfig([
  expoConfig,
  {
    ignores: ["dist/**", ".expo/**", "node_modules/**"],
  },
]);
