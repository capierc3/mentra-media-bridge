import {describe, expect, test} from "bun:test"
import {buildRows, wrap} from "./captions"

describe("wrap", () => {
  test("wraps on word boundaries", () => {
    expect(wrap("the quick brown fox jumps over the lazy dog", 15)).toEqual([
      "the quick brown",
      "fox jumps over",
      "the lazy dog",
    ])
  })

  test("splits words longer than a row", () => {
    expect(wrap("abcdefghijkl xy", 5)).toEqual(["abcde", "fghij", "kl xy"])
  })

  test("collapses whitespace and ignores empty input", () => {
    expect(wrap("  a   b \n c ", 10)).toEqual(["a b c"])
    expect(wrap("   ", 10)).toEqual([])
  })
})

describe("buildRows", () => {
  const caption = {
    lines: [
      {id: 1, text: "one two three four five six seven eight"},
      {id: 2, text: "nine ten eleven twelve thirteen fourteen"},
    ],
    partial: "fifteen sixteen",
  }

  test("live mode appends the words still being recognized", () => {
    const rows = buildRows(caption, {live: true, maxRows: 10, charsPerRow: 200})
    expect(rows).toEqual([
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
    ])
  })

  test("lines mode leaves the in-progress words out", () => {
    const rows = buildRows(caption, {live: false, maxRows: 10, charsPerRow: 200})
    expect(rows.join(" ").endsWith("fourteen")).toBe(true)
  })

  test("keeps only the newest rows", () => {
    const rows = buildRows(caption, {live: true, maxRows: 2, charsPerRow: 20})
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain("sixteen")
  })

  test("hides lines at or below afterId", () => {
    const rows = buildRows(caption, {live: false, maxRows: 10, charsPerRow: 200, afterId: 1})
    expect(rows).toEqual(["nine ten eleven twelve thirteen fourteen"])
    expect(buildRows(caption, {live: false, maxRows: 10, charsPerRow: 200, afterId: 2})).toEqual([])
  })

  test("handles an empty feed", () => {
    expect(buildRows({}, {live: true, maxRows: 4, charsPerRow: 30})).toEqual([])
  })
})
