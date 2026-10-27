/**
 * Uploading from this machine, and following a video until it is ready.
 *
 * `upload_video` sends a local file with YouTube's resumable upload protocol
 * (videos.insert), sets its details in the same call, can schedule it with
 * `status.publishAt`, and can set a custom thumbnail. An upload can outlast the
 * minute a client waits for one call, so it runs as a background job: over MCP
 * the call hands back a job id after `wait_seconds` and `upload_video_status`
 * follows it; in a terminal the command waits to the end.
 *
 * The risk depends on the arguments. A private upload with no publish time is a
 * write: nobody sees it, and it can be deleted from YouTube Studio. A public or
 * unlisted upload, or a scheduled one, puts the video in front of viewers and by
 * default notifies subscribers, so it asks first.
 *
 * Quota: videos.insert has its own bucket, 100 calls a day per Cloud project, one
 * per upload. thumbnails.set costs about 50 units of the main 10,000.
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { NotFoundError, UsageError } from "@thenavidm/slipway";
import { z } from "zod";
import { probeVideoFile, type VideoShape } from "../youtube/mp4.js";
import { setThumbnailFile, uploadVideoFile } from "../youtube/upload.js";
import { durationToSeconds } from "../youtube/api.js";
import { defineTool, type AnyToolSpec } from "./kit.js";

const account = z
  .string()
  .optional()
  .describe(
    "Which connected channel to upload to (name or @handle). Required when more than one is connected: without it the call fails and lists the choices rather than picking one.",
  );

/** videos.insert takes `video/*` or `application/octet-stream`; the extension picks the type. */
const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".3gp": "video/3gpp",
  ".flv": "video/x-flv",
  ".wmv": "video/x-ms-wmv",
};

/** thumbnails.set takes JPEG or PNG, up to 50MB. */
const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

/** videos.insert's documented ceiling. */
const MAX_VIDEO_BYTES = 256 * 1024 ** 3;
const MAX_THUMBNAIL_BYTES = 50 * 1024 * 1024;

/** YouTube's Shorts rule: up to 3 minutes, with a square or vertical aspect ratio. */
const SHORTS_MAX_SECONDS = 180;

/** `~/clip.mp4` and relative paths as the shell would read them. */
export function localPath(raw: string): string {
  const trimmed = raw.trim();
  const expanded = trimmed === "~" || trimmed.startsWith("~/") ? `${homedir()}${trimmed.slice(1)}` : trimmed;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

async function fileSize(path: string, what: string): Promise<number> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new UsageError(`${what} ${path} is not a file.`);
    return info.size;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new NotFoundError(`${what} ${path} does not exist or cannot be read on the machine running this server.`);
  }
}

/** Characters as YouTube counts them: code points, so an emoji is one. */
const characters = (text: string): number => [...text].length;

/** snippet.tags counts every tag, a comma between each, and two quotes around a tag with a space. */
export function tagsLength(tags: string[]): number {
  return tags.reduce((sum, tag) => sum + characters(tag) + (tag.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

/** The video metadata rules from the videos resource docs, checked before a byte is sent. */
export function checkDetails(args: { title: string; description?: string; tags?: string[]; publish_at?: string; privacy_status?: string }): void {
  const problems: string[] = [];
  if (!args.title.trim()) problems.push("title is empty");
  if (characters(args.title) > 100) problems.push(`title is ${characters(args.title)} characters; YouTube allows 100`);
  if (/[<>]/.test(args.title)) problems.push("title contains < or >, which YouTube does not allow");
  if (args.description !== undefined) {
    const bytes = Buffer.byteLength(args.description, "utf8");
    if (bytes > 5000) problems.push(`description is ${bytes} bytes; YouTube allows 5000`);
    if (/[<>]/.test(args.description)) problems.push("description contains < or >, which YouTube does not allow");
  }
  if (args.tags?.length && tagsLength(args.tags) > 500) {
    problems.push(`tags come to ${tagsLength(args.tags)} characters with their commas and quotes; YouTube allows 500`);
  }
  if (args.publish_at !== undefined) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(args.publish_at.trim()) || Number.isNaN(Date.parse(args.publish_at))) {
      problems.push(`publish_at "${args.publish_at}" is not an ISO 8601 time with a timezone, such as 2026-11-01T15:00:00Z`);
    }
    if (args.privacy_status && args.privacy_status !== "private") {
      problems.push(`publish_at needs privacy_status private (YouTube makes it public at that time), not ${args.privacy_status}`);
    }
  }
  if (problems.length) throw new UsageError(`Nothing was uploaded: ${problems.join("; ")}.`);
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/** Whether YouTube will treat the file as a Short, by its own rule. */
export function shortsVerdict(shape: VideoShape | undefined): { short: boolean | null; why: string } {
  if (!shape) return { short: null, why: "Could not read the file's size and length, so whether it becomes a Short is up to YouTube." };
  const size = `${shape.width}x${shape.height}`;
  const vertical = shape.height >= shape.width;
  const length = shape.durationSeconds;
  if (!vertical) return { short: false, why: `${size} is horizontal; a Short is square or vertical.` };
  if (length === undefined) return { short: null, why: `${size} is ${shape.height === shape.width ? "square" : "vertical"}, but the file's length could not be read.` };
  if (length > SHORTS_MAX_SECONDS) return { short: false, why: `${size}, ${clock(length)}: over YouTube's 3-minute Shorts limit.` };
  return { short: true, why: `${size}, ${clock(length)}: ${shape.height === shape.width ? "square" : "vertical"} and within YouTube's 3-minute Shorts limit.` };
}

/** Private with no publish time is a write; anything viewers will see asks first. */
export const uploadRisk = (args: { privacy_status?: string; publish_at?: string }): "write" | "destructive" =>
  (args.privacy_status ?? "private") === "private" && !args.publish_at ? "write" : "destructive";

const uploadVideo = defineTool({
  name: "upload_video",
  title: "Upload a video",
  description:
    "Upload a video file from this machine to a connected channel with YouTube's resumable upload, and set its title, description, tags, category, made-for-kids answer and privacy in the same call. Schedule it with publish_at: YouTube keeps it private and publishes it at that time, and a time in the past publishes it right away. A vertical or square video up to 3 minutes becomes a Short; the result says whether this file qualifies. Optionally sets a custom thumbnail. Uploads default to private. Private with no publish_at needs no confirmation; public, unlisted or scheduled needs confirm: true. Runs as a background job: when it outlasts the wait, follow it with upload_video_status, then get_video_status for YouTube's processing. Each upload spends one of the project's 100 daily videos.insert calls.",
  schema: {
    video_path: z.string().min(1).describe("Path to the video file on the machine running this server. Absolute is safest; ~ is expanded. MP4 or MOV is typical; YouTube accepts any video type up to 256GB."),
    title: z.string().min(1).describe("Up to 100 characters, without < or >."),
    description: z.string().optional().describe("Up to 5000 bytes, without < or >. Hashtags in it show above the title."),
    tags: z.array(z.string()).optional().describe("Keywords. All together up to 500 characters, counting a comma between tags and quotes around a tag with a space."),
    category_id: z.string().regex(/^\d+$/).optional().describe("YouTube's video category id. Defaults to 22, People & Blogs. 28 is Science & Technology, 27 Education, 24 Entertainment."),
    made_for_kids: z.boolean().describe("Whether the video is made for kids, YouTube's COPPA designation (status.selfDeclaredMadeForKids). Required: it is the channel owner's legal statement, so it is never assumed."),
    privacy_status: z.enum(["private", "unlisted", "public"]).optional().describe("Defaults to private. Must stay private when publish_at is set."),
    publish_at: z.string().optional().describe("Schedule the video: an ISO 8601 time with a timezone, such as 2026-11-01T15:00:00Z. The video stays private until then. A time in the past publishes it right away."),
    notify_subscribers: z.boolean().optional().describe("Whether YouTube notifies subscribers of the new video. Defaults to true, as YouTube does."),
    contains_synthetic_media: z.boolean().optional().describe("Discloses realistic altered or synthetic content, YouTube's label for AI-made footage that looks real."),
    thumbnail_path: z.string().optional().describe("A JPEG or PNG on this machine, up to 50MB, set as the custom thumbnail once the video is in. Costs about 50 quota units. If YouTube refuses it, the video stays uploaded and the result says why."),
    confirm: z.boolean().optional(),
    account,
  },
  risk: "destructive",
  riskFor: uploadRisk,
  consequence:
    "puts a video on your channel that viewers can watch, now or at its scheduled publish time, and unless notify_subscribers is false YouTube notifies your subscribers of the newly uploaded video, which cannot be taken back",
  idempotent: false,
  job: { background: true },
  examples: [
    {
      description: "Upload a vertical clip as a private draft to review in YouTube Studio",
      args: { video_path: "/Users/me/Movies/clip.mp4", title: "Three tools I use every day", made_for_kids: false },
    },
    {
      description: "Schedule a Short for Monday at 3pm UTC",
      args: {
        video_path: "/Users/me/Movies/short.mp4",
        title: "How I plan a week in 5 minutes #shorts",
        made_for_kids: false,
        publish_at: "2026-11-02T15:00:00Z",
        confirm: true,
      },
    },
  ],
  summary: (args) => {
    const when = args.publish_at ? `scheduled to publish ${args.publish_at}` : (args.privacy_status ?? "private");
    return `upload ${basename(args.video_path)} as "${args.title.slice(0, 80)}" (${when})${args.account ? ` to ${args.account}` : ""}`;
  },
  handler: async (args, ctx) => {
    checkDetails(args);
    const videoPath = localPath(args.video_path);
    const size = await fileSize(videoPath, "Video");
    if (size === 0) throw new UsageError(`Nothing was uploaded: ${videoPath} is empty.`);
    if (size > MAX_VIDEO_BYTES) throw new UsageError(`Nothing was uploaded: ${videoPath} is over YouTube's 256GB limit.`);

    let thumbnail: { path: string; type: string } | undefined;
    if (args.thumbnail_path) {
      const path = localPath(args.thumbnail_path);
      const type = IMAGE_TYPES[extname(path).toLowerCase()];
      if (!type) throw new UsageError(`Nothing was uploaded: the thumbnail must be a .jpg, .jpeg or .png file, not ${basename(path)}.`);
      const bytes = await fileSize(path, "Thumbnail");
      if (bytes > MAX_THUMBNAIL_BYTES) throw new UsageError(`Nothing was uploaded: the thumbnail is ${(bytes / 1024 ** 2).toFixed(1)}MB; YouTube allows 50MB.`);
      thumbnail = { path, type };
    }

    // Resolve the channel before reading the file, so a missing or ambiguous account fails first.
    const client = ctx.clientFor(args.account);
    const shape = await probeVideoFile(videoPath, size);
    const privacy = args.publish_at ? "private" : (args.privacy_status ?? "private");

    const status: Record<string, unknown> = {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: args.made_for_kids,
      ...(args.publish_at ? { publishAt: new Date(args.publish_at).toISOString() } : {}),
      ...(args.contains_synthetic_media !== undefined ? { containsSyntheticMedia: args.contains_synthetic_media } : {}),
    };
    const snippet: Record<string, unknown> = {
      title: args.title,
      // categoryId is required on every snippet write; 22 is "People & Blogs", as update_video uses.
      categoryId: args.category_id ?? "22",
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.tags?.length ? { tags: args.tags } : {}),
    };

    const video = await uploadVideoFile(client, {
      path: videoPath,
      mimeType: VIDEO_TYPES[extname(videoPath).toLowerCase()] ?? "application/octet-stream",
      metadata: { snippet, status },
      notifySubscribers: args.notify_subscribers ?? true,
      signal: ctx.signal,
      onProgress: (sent, total) => void ctx.progress?.(sent, total, `uploaded ${(sent / 1024 ** 2).toFixed(1)} of ${(total / 1024 ** 2).toFixed(1)} MB`),
    });
    const id = video.id;
    if (!id) throw new NotFoundError("YouTube finished the upload but returned no video id. Check YouTube Studio for the video.");

    let thumbnailResult: Record<string, unknown> | undefined;
    if (thumbnail) {
      try {
        await setThumbnailFile(client, id, thumbnail.path, thumbnail.type, ctx.signal);
        thumbnailResult = { set: true };
      } catch (error) {
        // The video is in. Say why the thumbnail is not, rather than failing an upload that worked.
        thumbnailResult = { set: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const publishAt = video.status?.publishAt ?? (args.publish_at ? new Date(args.publish_at).toISOString() : undefined);
    const pastSchedule = publishAt !== undefined && Date.parse(publishAt) <= Date.now();
    const shorts = shortsVerdict(shape);
    return {
      video_id: id,
      url: `https://youtu.be/${id}`,
      studio_url: `https://studio.youtube.com/video/${id}/edit`,
      title: video.snippet?.title ?? args.title,
      channel: video.snippet?.channelTitle ?? null,
      privacy_status: video.status?.privacyStatus ?? privacy,
      upload_status: video.status?.uploadStatus ?? "uploaded",
      ...(publishAt ? { publish_at: publishAt, scheduled: !pastSchedule } : {}),
      ...(pastSchedule ? { note: "publish_at was in the past, so YouTube publishes it right away." } : {}),
      made_for_kids: args.made_for_kids,
      bytes: size,
      ...(shape ? { width: shape.width, height: shape.height, ...(shape.durationSeconds ? { duration_seconds: Math.round(shape.durationSeconds * 10) / 10 } : {}) } : {}),
      short: shorts.short,
      short_reason: shorts.why,
      ...(thumbnailResult ? { thumbnail: thumbnailResult } : {}),
      next: `YouTube is processing it now. Check with get_video_status ${id}.`,
    };
  },
});

type VideoStatusItem = {
  id?: string;
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string };
  contentDetails?: { duration?: string };
  status?: {
    uploadStatus?: string;
    failureReason?: string;
    rejectionReason?: string;
    privacyStatus?: string;
    publishAt?: string;
    madeForKids?: boolean;
    selfDeclaredMadeForKids?: boolean;
  };
  processingDetails?: {
    processingStatus?: string;
    processingProgress?: { partsTotal?: string; partsProcessed?: string; timeLeftMs?: string };
    processingFailureReason?: string;
  };
};

/** One word for where a video stands, from its upload, processing and privacy status. */
export function videoState(item: VideoStatusItem, now = Date.now()): string {
  const upload = item.status?.uploadStatus;
  if (upload === "failed" || upload === "rejected" || upload === "deleted") return upload;
  if (item.processingDetails?.processingStatus === "failed") return "failed";
  if (item.processingDetails?.processingStatus === "processing") return "processing";
  if (upload === "uploaded") return "uploaded";
  const publishAt = item.status?.publishAt ? Date.parse(item.status.publishAt) : Number.NaN;
  if (item.status?.privacyStatus === "private" && publishAt > now) return "scheduled";
  return item.status?.privacyStatus ?? upload ?? "unknown";
}

const getVideoStatus = defineTool({
  name: "get_video_status",
  title: "Check an upload",
  description:
    "Where a video on a connected channel stands: uploaded and waiting, processing (with percent done and time left), scheduled for its publish time, failed or rejected with YouTube's reason, or live as private, unlisted or public. Processing details are visible only to the channel that owns the video. Costs 1 quota unit.",
  schema: { video_id: z.string().min(1).describe("The video id, from upload_video or list_my_videos."), account },
  risk: "read",
  examples: [{ description: "Check whether an upload has finished processing", args: { video_id: "dQw4w9WgXcQ" } }],
  handler: async (args, ctx) => {
    const res = await ctx
      .clientFor(args.account)
      .get<{ items?: VideoStatusItem[] }>(
        "/videos",
        { part: "snippet,status,processingDetails,contentDetails", id: args.video_id },
        true,
      );
    const item = res.items?.[0];
    if (!item) throw new NotFoundError(`No video ${args.video_id} on this channel, or it is not yours to see.`);

    const progress = item.processingDetails?.processingProgress;
    const total = Number(progress?.partsTotal ?? 0);
    const done = Number(progress?.partsProcessed ?? 0);
    const state = videoState(item);
    return {
      video_id: item.id ?? args.video_id,
      url: `https://youtu.be/${item.id ?? args.video_id}`,
      title: item.snippet?.title ?? null,
      state,
      upload_status: item.status?.uploadStatus ?? null,
      processing_status: item.processingDetails?.processingStatus ?? null,
      ...(state === "processing" && total > 0 ? { processing_percent: Math.min(100, Math.round((100 * done) / total)) } : {}),
      ...(state === "processing" && progress?.timeLeftMs ? { processing_seconds_left: Math.round(Number(progress.timeLeftMs) / 1000) } : {}),
      privacy_status: item.status?.privacyStatus ?? null,
      ...(item.status?.publishAt ? { publish_at: item.status.publishAt } : {}),
      ...(item.status?.failureReason ? { failure_reason: item.status.failureReason } : {}),
      ...(item.processingDetails?.processingFailureReason ? { processing_failure_reason: item.processingDetails.processingFailureReason } : {}),
      ...(item.status?.rejectionReason ? { rejection_reason: item.status.rejectionReason } : {}),
      made_for_kids: item.status?.madeForKids ?? item.status?.selfDeclaredMadeForKids ?? null,
      duration_seconds: durationToSeconds(item.contentDetails?.duration),
      ...(item.snippet?.publishedAt ? { published_at: item.snippet.publishedAt } : {}),
    };
  },
});

export const uploadTools: AnyToolSpec[] = [uploadVideo, getVideoStatus].map((t) => t as AnyToolSpec);
