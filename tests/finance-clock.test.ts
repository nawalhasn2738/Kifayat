import assert from "node:assert/strict"
import test from "node:test"
import { getAnalysisDate } from "../src/lib/finance/clock"

test("configured finance date is deterministic", () => {
  const previous = process.env.FINANCE_AS_OF_DATE
  process.env.FINANCE_AS_OF_DATE = "2026-05-10"
  try {
    const date = getAnalysisDate()
    assert.equal(date.getFullYear(), 2026)
    assert.equal(date.getMonth(), 4)
    assert.equal(date.getDate(), 10)
  } finally {
    if (previous === undefined) delete process.env.FINANCE_AS_OF_DATE
    else process.env.FINANCE_AS_OF_DATE = previous
  }
})

test("invalid configured finance date is rejected", () => {
  const previous = process.env.FINANCE_AS_OF_DATE
  process.env.FINANCE_AS_OF_DATE = "May 10"
  try {
    assert.throws(() => getAnalysisDate(), /YYYY-MM-DD/)
  } finally {
    if (previous === undefined) delete process.env.FINANCE_AS_OF_DATE
    else process.env.FINANCE_AS_OF_DATE = previous
  }
})
