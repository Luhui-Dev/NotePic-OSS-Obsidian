import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Tests don't run inside Obsidian, so swap the host-provided module
      // for a hand-written stub.
      obsidian: fileURLToPath(new URL("./tests/_obsidian-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
