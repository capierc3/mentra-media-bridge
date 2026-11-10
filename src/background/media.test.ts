import {describe, expect, test} from "bun:test"
import {MediaClock, buildTimeBar, formatTime, hasTrack, sourceLine, truncate} from "./media"

describe("formatTime", () => {
  test("minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00")
    expect(formatTime(754_000)).toBe("12:34")
    expect(formatTime(4_000_000)).toBe("66:40")
  })
  test("hours", () => {
    expect(formatTime(3_725_000, true)).toBe("1:02:05")
    expect(formatTime(65_000, true)).toBe("0:01:05")
  })
})

describe("truncate", () => {
  test("leaves short text alone", () => expect(truncate("Hello", 10)).toBe("Hello"))
  test("adds an ellipsis", () => expect(truncate("Hello there world", 10)).toBe("Hello the…"))
})

describe("MediaClock", () => {
  const playing = {state: "playing", title: "Ep 1", duration: 600_000, position: 10_000}

  test("counts forward while playing", () => {
    const c = new MediaClock()
    c.update(playing, 1000)
    expect(c.positionMs(6000)).toBe(15_000)
  })

  test("does not jump back when the same stale snapshot repeats", () => {
    const c = new MediaClock()
    c.update(playing, 1000)
    c.update({...playing}, 4000) // bridge still says 10 s
    expect(c.positionMs(6000)).toBe(15_000)
  })

  test("re-bases on a new report and holds while paused", () => {
    const c = new MediaClock()
    c.update(playing, 1000)
    c.update({...playing, state: "paused", position: 20_000}, 9000)
    expect(c.positionMs(60_000)).toBe(20_000)
  })

  test("never passes the end", () => {
    const c = new MediaClock()
    c.update({...playing, position: 599_000}, 0)
    expect(c.positionMs(10_000)).toBe(600_000)
  })

  test("unknown position", () => {
    const c = new MediaClock()
    c.update({...playing, position: -1}, 0)
    expect(c.positionMs(1000)).toBe(-1)
  })
})

describe("buildTimeBar", () => {
  test("elapsed, total and remaining", () => {
    const bar = buildTimeBar({state: "playing", duration: 2_710_000}, 754_000)
    expect(bar.text).toBe("▶ 12:34 / 45:10   -32:36")
    expect(bar.progress).toBeCloseTo(754 / 2710)
  })
  test("paused icon and hour format", () => {
    const bar = buildTimeBar({state: "paused", duration: 7_200_000}, 3_600_000)
    expect(bar.text).toBe("❚❚ 1:00:00 / 2:00:00   -1:00:00")
  })
  test("live streams have no progress bar", () => {
    const bar = buildTimeBar({state: "playing", duration: 0, live: true}, -1)
    expect(bar).toEqual({text: "▶ LIVE", progress: null})
  })
})

describe("helpers", () => {
  test("hasTrack", () => {
    expect(hasTrack(null)).toBe(false)
    expect(hasTrack({enabled: false})).toBe(false)
    expect(hasTrack({state: "none"})).toBe(false)
    expect(hasTrack({state: "paused"})).toBe(true)
  })
  test("sourceLine", () => {
    expect(sourceLine({artist: "Jane Doe", app: "Pocket Casts"})).toBe("Jane Doe · Pocket Casts")
    expect(sourceLine({app: "Audible"})).toBe("Audible")
  })
})
