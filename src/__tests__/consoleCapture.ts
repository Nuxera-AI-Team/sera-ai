import { inspect } from "node:util";
import { vi } from "vitest";

const CONSOLE_METHODS = ["log", "info", "debug", "warn", "error", "trace", "dir", "table"] as const;

// Silences every console method and returns a reader for everything they were
// called with, rendered the way devtools would show it (objects expanded,
// errors with their message), so a test can assert that a value never reaches
// the console in any form. Restore with vi.restoreAllMocks().
export const captureConsole = () => {
  const spies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  );

  return () =>
    spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: Infinity })))
      .join("\n");
};
