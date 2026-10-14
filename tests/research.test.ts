import { describe, expect, it } from "vitest";
import { scoreChannel, toTsv, type ChannelVideo } from "../src/tools/research.js";

const today = new Date("2026-10-14T00:00:00Z");
const video = (id: string, views: number, seconds: number, published = "2026-08-01"): ChannelVideo => ({
  id,
  title: `Video ${id}`,
  published,
  views,
  seconds,
});

describe("scoreChannel", () => {
  it("scores Shorts and long videos each against their own median", () => {
    const rows = [
      video("l1", 1000, 900),
      video("l2", 2000, 900),
      video("l3", 3000, 900),
      video("s1", 50_000, 40),
      video("s2", 100_000, 40),
      video("s3", 150_000, 40),
    ];
    const { videos, medians, counts } = scoreChannel(rows, { today });
    expect(medians).toEqual({ long: 2000, short: 100_000 });
    expect(counts).toEqual({ long: 3, short: 3 });
    const by = Object.fromEntries(videos.map((v) => [v.id, v.multiple]));
    expect(by.l3).toBe(1.5);
    expect(by.s3).toBe(1.5);
    // A pooled median (26,500) would have called every Short a hit and every long video a flop.
    expect(by.s1).toBe(0.5);
  });

  it("treats three minutes as a Short and one second more as a long video", () => {
    const { videos } = scoreChannel([video("a", 1, 180), video("b", 1, 181), video("c", 1, 0)], { today });
    const kind = Object.fromEntries(videos.map((v) => [v.id, v.kind]));
    expect(kind).toEqual({ a: "short", b: "long", c: "long" });
  });

  it("lists a video younger than min_age_days without scoring it or counting it in the median", () => {
    const rows = [video("old1", 100, 600, "2026-08-01"), video("old2", 300, 600, "2026-08-02"), video("new", 5, 600, "2026-10-12")];
    const { videos, medians } = scoreChannel(rows, { today, minAgeDays: 14 });
    expect(medians.long).toBe(200);
    const fresh = videos.find((v) => v.id === "new");
    expect(fresh).toMatchObject({ scored: false, multiple: null, ageDays: 2 });
    expect(videos.at(-1)?.id).toBe("new");
  });

  it("scores everything by default, as before", () => {
    const { videos } = scoreChannel([video("a", 10, 600, "2026-10-13"), video("b", 30, 600)], { today });
    expect(videos.every((v) => v.scored)).toBe(true);
  });
});

describe("toTsv", () => {
  it("gives every row with a header, and keeps tabs and line breaks out of titles", () => {
    const { videos } = scoreChannel([{ ...video("a", 10, 600), title: "One\ttwo\nthree" }, video("b", 30, 600)], { today });
    const lines = toTsv(videos).split("\n");
    expect(lines[0]).toBe("id\tpublished\tageDays\tviews\tseconds\tkind\tscored\tmultiple\ttitle");
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.split("\t").length === 9)).toBe(true);
    expect(lines[2]).toContain("One two three");
  });
});

import { parseMostReplayed } from "../src/youtube/ytdlp.js";
import { replayPeaks } from "../src/tools/transcripts.js";

describe("most replayed", () => {
  const info = (values: number[] | null) =>
    JSON.stringify({
      title: "A video",
      duration: 200,
      view_count: 5000,
      heatmap: values === null ? null : values.map((value, i) => ({ start_time: i * 2, end_time: i * 2 + 2, value })),
    });

  it("reads yt-dlp's heatmap into stretches", () => {
    const m = parseMostReplayed(info([1, 0.4, 0.3]), "abc");
    expect(m).toMatchObject({ videoId: "abc", title: "A video", seconds: 200, views: 5000 });
    expect(m.points[1]).toEqual({ start: 2, end: 4, value: 0.4 });
  });

  it("returns no stretches when YouTube shows no graph", () => {
    expect(parseMostReplayed(info(null), "abc").points).toEqual([]);
    expect(parseMostReplayed(JSON.stringify({ title: "x" }), "abc").points).toEqual([]);
  });

  it("finds the peaks after the opening, highest first", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i === 0 ? 1 : i === 40 ? 0.9 : i === 70 ? 0.6 : 0.2));
    const peaks = replayPeaks(parseMostReplayed(info(values), "abc"));
    expect(peaks.slice(0, 2).map((p) => p.start)).toEqual([80, 140]);
    expect(peaks.every((p) => p.start >= 10)).toBe(true);
  });
});
