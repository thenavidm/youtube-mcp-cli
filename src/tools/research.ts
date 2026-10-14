/**
 * Research tools: anyone's channel, not just yours.
 *
 * The difference between these and a thin API wrapper is that YouTube's search
 * endpoint returns no statistics at all. No views, no subscriber counts, no
 * duration. A model handed those results cannot tell a hit from a flop, so it
 * guesses confidently. Every search here joins the stats back on before it
 * returns, which costs one extra call and removes the guessing.
 *
 * `analyze_channel` scores each video against that channel's OWN median rather
 * than an absolute view count. "Did this beat what this channel normally does"
 * is the only form of the question that transfers between a 2,000-subscriber
 * channel and a 2,000,000-subscriber one.
 */

import { z } from "zod";
import { durationToSeconds } from "../youtube/api.js";
import { clamp, defineTool, type AnyToolSpec } from "./kit.js";
import { NotFoundError } from "@thenavidm/slipway";

type SearchItem = { id?: { videoId?: string } };
type VideoItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    tags?: string[];
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};
type ChannelItem = {
  id?: string;
  snippet?: { title?: string; customUrl?: string; publishedAt?: string };
  statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

const num = (v?: string) => (v === undefined ? null : Number(v));
const account = z
  .string()
  .optional()
  .describe("Which connected channel's quota to spend. Only matters when several are connected.");

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export type ChannelVideo = { id: string; title: string; published: string; views: number; seconds: number };
export type ScoredVideo = ChannelVideo & {
  kind: "short" | "long";
  ageDays: number | null;
  /** False when the video is younger than min_age_days: its views are still climbing, so it is listed, not scored. */
  scored: boolean;
  multiple: number | null;
};

/**
 * Each video against the median of the same kind on the same channel. A Short's
 * views are not comparable to a long video's, so a pooled median makes every
 * Short look like a hit on a long-form channel and every long video look weak on
 * a Shorts channel. Three minutes or under is treated as a Short, since a square
 * or vertical upload up to three minutes is one; the API does not say a video's
 * aspect ratio, so a short horizontal video counts as a Short too.
 */
export function scoreChannel(rows: ChannelVideo[], opts: { today?: Date; minAgeDays?: number } = {}) {
  const today = opts.today ?? new Date();
  const minAge = opts.minAgeDays ?? 0;
  const withAge = rows.map((r) => {
    const t = Date.parse(r.published);
    const ageDays = Number.isNaN(t) ? null : Math.floor((today.getTime() - t) / 86_400_000);
    const kind: "short" | "long" = r.seconds > 0 && r.seconds <= 180 ? "short" : "long";
    return { ...r, kind, ageDays, scored: ageDays === null ? minAge === 0 : ageDays >= minAge };
  });
  const medians = {
    short: median(withAge.filter((r) => r.kind === "short" && r.scored).map((r) => r.views)),
    long: median(withAge.filter((r) => r.kind === "long" && r.scored).map((r) => r.views)),
  };
  const counts = {
    short: withAge.filter((r) => r.kind === "short" && r.scored).length,
    long: withAge.filter((r) => r.kind === "long" && r.scored).length,
  };
  const videos: ScoredVideo[] = withAge
    .map((r) => ({ ...r, multiple: r.scored && medians[r.kind] > 0 ? r.views / medians[r.kind] : null }))
    .sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1));
  return { videos, medians, counts };
}

/** Every row, tab-separated with a header, for a script to read without parsing prose. */
export function toTsv(videos: ScoredVideo[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  return [
    "id\tpublished\tageDays\tviews\tseconds\tkind\tscored\tmultiple\ttitle",
    ...videos.map((v) =>
      [v.id, v.published, v.ageDays ?? "", v.views, v.seconds, v.kind, v.scored, v.multiple === null ? "" : v.multiple.toFixed(3), clean(v.title)].join("\t"),
    ),
  ].join("\n");
}

/** The Data API takes at most 50 ids per call. */
function chunk<T>(items: T[], size = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Accepts `@handle`, a `UC…` id, or any channel URL, because people paste all three. */
function channelQuery(input: string): Record<string, unknown> {
  const raw = input.trim();
  const byId = /^UC[\w-]{22}$/.test(raw) ? raw : raw.match(/\/channel\/(UC[\w-]{22})/)?.[1];
  if (byId) return { id: byId };
  const handle = raw.match(/@([\w.-]+)/)?.[1] ?? raw.replace(/^@/, "");
  return { forHandle: `@${handle}` };
}

export const researchTools: AnyToolSpec[] = [
  defineTool({
    name: "search_videos",
    title: "Search videos",
    description:
      "Search YouTube and get results WITH view counts, likes and duration attached. Plain API search returns none of those, so use this whenever you need to judge whether a result actually performed rather than just matched. Search has its own allowance of 100 calls a day, separate from the 10,000-unit pool the other endpoints share, so use it deliberately rather than as a first guess.",
    schema: {
      query: z.string().min(1),
      max_results: z.number().min(1).max(50).optional().describe("Default 25."),
      order: z.enum(["relevance", "date", "viewCount", "rating", "title"]).optional(),
      published_after: z.string().optional().describe("RFC 3339, e.g. 2026-01-01T00:00:00Z"),
      published_before: z.string().optional(),
      channel_id: z.string().optional().describe("Restrict to one channel."),
      min_views: z.number().optional().describe("Drop results below this, applied after the stats join."),
      account,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const client = ctx.clientFor(args.account);
      const search = await client.get<{ items?: SearchItem[] }>("/search", {
        part: "snippet",
        type: "video",
        q: args.query,
        maxResults: clamp(args.max_results, 25),
        order: args.order,
        publishedAfter: args.published_after,
        publishedBefore: args.published_before,
        channelId: args.channel_id,
      });

      const ids = (search.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => !!v);
      if (ids.length === 0) return "No results.";

      const details = await client.get<{ items?: VideoItem[] }>("/videos", {
        part: "snippet,statistics,contentDetails",
        id: ids.join(","),
      });

      let rows = (details.items ?? []).map((v) => ({
        id: v.id ?? "",
        title: v.snippet?.title ?? "",
        channel: v.snippet?.channelTitle ?? "",
        published: v.snippet?.publishedAt?.slice(0, 10) ?? "",
        views: num(v.statistics?.viewCount) ?? 0,
        seconds: durationToSeconds(v.contentDetails?.duration),
      }));
      if (args.min_views !== undefined) rows = rows.filter((r) => r.views >= args.min_views!);
      rows.sort((a, b) => b.views - a.views);

      return `${rows.length} result(s)\n\n${rows
        .map(
          (r) =>
            `${r.views.toLocaleString()} views · ${r.published} · ${r.seconds ? `${Math.round(r.seconds / 60)}m` : "?"} · ${r.channel}\n${r.title}\nhttps://youtu.be/${r.id}`,
        )
        .join("\n\n")}`;
    },
  }),

  defineTool({
    name: "get_channel",
    title: "Look up a channel",
    description:
      "Look up any channel by @handle, id or URL. Returns subscribers, total views, video count and the uploads playlist id. Subscriber counts are rounded by YouTube itself above 1,000 and read as `hidden` when the owner hides them.",
    schema: { channel: z.string().describe("@handle, channel id (UC…), or a channel URL."), account },
    risk: "read",
    handler: async (args, ctx) => {
      const res = await ctx.clientFor(args.account).get<{ items?: ChannelItem[] }>("/channels", {
        part: "snippet,statistics,contentDetails",
        ...channelQuery(args.channel),
      });
      const c = res.items?.[0];
      if (!c) throw new NotFoundError(`No channel found for "${args.channel}".`);
      return [
        c.snippet?.title,
        c.snippet?.customUrl ? `@${c.snippet.customUrl.replace(/^@/, "")}` : null,
        `id: ${c.id}`,
        `subscribers: ${num(c.statistics?.subscriberCount)?.toLocaleString() ?? "hidden"}`,
        `videos: ${num(c.statistics?.videoCount)?.toLocaleString() ?? "?"}`,
        `total views: ${num(c.statistics?.viewCount)?.toLocaleString() ?? "?"}`,
        `created: ${c.snippet?.publishedAt?.slice(0, 10) ?? "?"}`,
        `uploads playlist: ${c.contentDetails?.relatedPlaylists?.uploads ?? "?"}`,
      ]
        .filter(Boolean)
        .join("\n");
    },
  }),

  defineTool({
    name: "analyze_channel",
    title: "Analyze a channel's performance",
    description:
      "Score a channel's recent videos against its OWN median views, so you can see which ones genuinely outperformed rather than which are simply oldest. Returns a multiple per video, so 3.2x means it did three times that channel's normal numbers. Use this before modelling anyone's content. Shorts and long videos are each scored against their own median, because their views are not comparable. Set min_age_days to leave out videos whose views are still climbing, and format tsv for every row as data.",
    schema: {
      channel: z.string().describe("@handle, channel id, or URL."),
      limit: z.number().min(5).max(200).optional().describe("How many recent videos to score. Default 30."),
      min_age_days: z
        .number()
        .min(0)
        .max(365)
        .optional()
        .describe("Videos published fewer days ago than this are listed but not scored, and left out of the medians. Default 0."),
      format: z
        .enum(["text", "tsv"])
        .optional()
        .describe("text (default): the winners and the weakest five. tsv: every video as a tab-separated row, for a script."),
      account,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const client = ctx.clientFor(args.account);
      const chan = await client.get<{ items?: ChannelItem[] }>("/channels", {
        part: "snippet,statistics,contentDetails",
        ...channelQuery(args.channel),
      });
      const c = chan.items?.[0];
      const uploads = c?.contentDetails?.relatedPlaylists?.uploads;
      if (!c || !uploads) throw new NotFoundError(`No channel found for "${args.channel}".`);

      const want = args.limit ?? 30;
      const ids: string[] = [];
      let pageToken: string | undefined;
      while (ids.length < want) {
        const page = await client.get<{
          items?: { contentDetails?: { videoId?: string } }[];
          nextPageToken?: string;
        }>("/playlistItems", {
          part: "contentDetails",
          playlistId: uploads,
          maxResults: Math.min(50, want - ids.length),
          pageToken,
        });
        for (const it of page.items ?? []) {
          const v = it.contentDetails?.videoId;
          if (v) ids.push(v);
        }
        pageToken = page.nextPageToken;
        if (!pageToken) break;
      }

      const videos: VideoItem[] = [];
      for (const batch of chunk(ids)) {
        const res = await client.get<{ items?: VideoItem[] }>("/videos", {
          part: "snippet,statistics,contentDetails",
          id: batch.join(","),
        });
        videos.push(...(res.items ?? []));
      }

      const rows = videos.map((v) => ({
        id: v.id ?? "",
        title: v.snippet?.title ?? "",
        published: v.snippet?.publishedAt?.slice(0, 10) ?? "",
        views: num(v.statistics?.viewCount) ?? 0,
        seconds: durationToSeconds(v.contentDetails?.duration) ?? 0,
      }));
      const { videos: scored, medians, counts } = scoreChannel(rows, { minAgeDays: args.min_age_days });
      if (args.format === "tsv") return toTsv(scored);

      const fmt = (r: ScoredVideo) =>
        `${r.multiple === null ? "not scored" : `${r.multiple.toFixed(2)}x`} · ${r.views.toLocaleString()} views · ${r.published}${r.kind === "short" ? " · short" : ""}\n${r.title}\nhttps://youtu.be/${r.id}`;
      const kinds = (["long", "short"] as const)
        .filter((k) => counts[k] > 0)
        .map((k) => `${k === "long" ? "long videos" : "Shorts"}: median ${medians[k].toLocaleString()} views over ${counts[k]}`);
      const young = scored.filter((r) => !r.scored);
      const ranked = scored.filter((r) => r.multiple !== null);

      return [
        `${c.snippet?.title} · ${num(c.statistics?.subscriberCount)?.toLocaleString() ?? "hidden"} subscribers`,
        `scored ${ranked.length} of ${scored.length} recent videos, each against its own kind: ${kinds.join("; ") || "none"}`,
        "",
        "## Beat the median",
        ranked.filter((r) => (r.multiple ?? 0) > 1).map(fmt).join("\n\n") || "none",
        "",
        "## Weakest five",
        ranked.filter((r) => (r.multiple ?? 0) <= 1).slice(-5).map(fmt).join("\n\n") || "none",
        ...(young.length ? ["", `## Too new to score (under ${args.min_age_days} days)`, young.map(fmt).join("\n\n")] : []),
      ].join("\n");
    },
  }),

  defineTool({
    name: "get_video",
    title: "Get video detail",
    description:
      "Full detail for one video: title, description, channel, views, likes, comments, duration and tags. Tags are only returned to the channel that owns the video, so they read as empty for anyone else's.",
    schema: { video: z.string().describe("Video id or URL."), account },
    risk: "read",
    handler: async (args, ctx) => {
      const id = args.video.match(/[\w-]{11}/)?.[0] ?? args.video;
      const res = await ctx.clientFor(args.account).get<{ items?: VideoItem[] }>("/videos", {
        part: "snippet,statistics,contentDetails",
        id,
      });
      const v = res.items?.[0];
      if (!v) throw new NotFoundError(`No video found for "${args.video}".`);
      const secs = durationToSeconds(v.contentDetails?.duration);
      return [
        v.snippet?.title,
        `${v.snippet?.channelTitle} · ${v.snippet?.publishedAt?.slice(0, 10)}`,
        `${num(v.statistics?.viewCount)?.toLocaleString() ?? "?"} views · ${num(v.statistics?.likeCount)?.toLocaleString() ?? "?"} likes · ${num(v.statistics?.commentCount)?.toLocaleString() ?? "?"} comments`,
        secs ? `duration: ${Math.floor(secs / 60)}m ${secs % 60}s` : null,
        v.snippet?.tags?.length ? `tags: ${v.snippet.tags.join(", ")}` : null,
        "",
        v.snippet?.description ?? "",
      ]
        .filter((l) => l !== null)
        .join("\n");
    },
  }),
].map((t) => t as AnyToolSpec);
