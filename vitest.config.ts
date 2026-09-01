import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The unit-tested logic (v2 transcript/note transforms) is pure — no DOM.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
