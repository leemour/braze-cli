import { describe, expect, it } from "vitest"
import { BrazeError, errorCodes } from "./errors.js"

describe("error model", () => {
  it("keeps the code list unique", () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length)
  })

  it("carries the code and details an agent branches on", () => {
    const error = new BrazeError("rate_limited", "slow down", { httpStatus: 429, retryAfterMs: 1200 })

    expect(error.code).toBe("rate_limited")
    expect(error.details.retryAfterMs).toBe(1200)
    expect(error).toBeInstanceOf(Error)
  })
})
