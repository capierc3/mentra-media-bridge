import {describe, expect, test} from "bun:test"
import {NOTHING_HIDDEN, buildRows, isHidden, markAll, markStillValid, wrap} from "./captions"

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

  test("hides lines covered by the mark (by id when there are no time stamps)", () => {
    const rows = buildRows(caption, {live: false, maxRows: 10, charsPerRow: 200, hidden: {t: -1, id: 1}})
    expect(rows).toEqual(["nine ten eleven twelve thirteen fourteen"])
    expect(buildRows(caption, {live: false, maxRows: 10, charsPerRow: 200, hidden: markAll(caption)})).toEqual([])
  })

  test("handles an empty feed", () => {
    expect(buildRows({}, {live: true, maxRows: 4, charsPerRow: 30})).toEqual([])
  })
})

describe("hiding cleared lines across a bridge restart", () => {
  // Before the restart: ids 7-8, stamped at 1000 and 2000 ms.
  const before = {
    lines: [
      {id: 7, text: "old line seven", t: 1000},
      {id: 8, text: "old line eight", t: 2000},
    ],
  }
  // After the restart the bridge numbers from 1 again, but time keeps rising.
  const after = {
    lines: [
      {id: 1, text: "new line one", t: 5000},
      {id: 2, text: "new line two", t: 6000},
    ],
  }
  const opts = {live: false, maxRows: 10, charsPerRow: 200}

  test("markAll covers every current line", () => {
    expect(markAll(before)).toEqual({t: 2000, id: 8})
    expect(markAll(null)).toEqual(NOTHING_HIDDEN)
  })

  test("new lines show after a restart (time stamps win over ids)", () => {
    const mark = markAll(before)
    expect(buildRows(before, {...opts, hidden: mark})).toEqual([])
    expect(buildRows(after, {...opts, hidden: mark})).toEqual(["new line one new line two"])
    expect(markStillValid(after, mark)).toBe(true)
  })

  test("without time stamps, a restart is detected so the mark can be dropped", () => {
    const strip = (c: typeof before) => ({lines: c.lines.map(({id, text}) => ({id, text}))})
    const mark = markAll(strip(before))
    expect(isHidden({id: 1, text: "x"}, mark)).toBe(true) // would wrongly hide new lines
    expect(markStillValid(strip(after), mark)).toBe(false) // so we notice and reset
    expect(markStillValid(strip(before), mark)).toBe(true)
  })
})
