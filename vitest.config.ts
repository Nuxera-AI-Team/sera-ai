import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    // Two suites with incompatible needs. The hook tests install global Web
    // Audio and MediaDevices fakes for jsdom; the pure ones drive their own
    // doubles and would be fighting those globals. Separate projects keep each
    // setup where it belongs.
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/lib/**/*.test.ts", "src/components/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "hooks",
          environment: "jsdom",
          setupFiles: ["./src/__tests__/setup.ts"],
          include: ["src/__tests__/**/*.test.ts"],
        },
      },
    ],
  },
});
