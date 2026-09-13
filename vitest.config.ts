import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    // No globals: core's tsconfig sets `types: []` to keep @types/node out, and injected
    // globals would need a types entry that reopens that door.
    globals: false,
  },
})
