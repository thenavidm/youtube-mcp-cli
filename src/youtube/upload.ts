/**
 * Uploading a local file with YouTube's resumable upload protocol.
 *
 * https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *
 * Three steps. POST the video's metadata to start a session and keep the
 * session URI from the `Location` header. PUT the file to that URI in chunks,
 * each a multiple of 256 KB except the last, and read the `Range` header of
 * each `308 Resume Incomplete` for how much YouTube really has. The last chunk
 * answers 200 or 201 with the new video.
 *
 * A dropped connection or a 500, 502, 503 or 504 is not the end of an upload:
 * an empty PUT whose Content-Range names only the total asks where it stands,
 * and the upload resumes from there after an exponential backoff, as the guide
 * asks.
 * Any other 4xx is permanent, and a 404 means the session itself expired.
 *
 * The file is read from disk as a Blob, so a 10 GB video never sits in memory:
 * each chunk is a slice that streams when it is sent.
 */

import { openAsBlob } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError } from "@thenavidm/slipway";
import { apiError, type YouTubeClient } from "./api.js";

export const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";

/** 32 times 256 KB. The protocol takes any multiple of 256 KB for every chunk but the last. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** The guide's retryable statuses. Every other 4xx or 5xx is permanent. */
const RETRYABLE = new Set([500, 502, 503, 504]);

/** Exponential backoff between attempts that made no progress, capped at a minute. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];

export type VideoResource = {
  id?: string;
  snippet?: { title?: string; channelId?: string; channelTitle?: string };
  status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string; selfDeclaredMadeForKids?: boolean };
};

export type UploadOptions = {
  path: string;
  mimeType: string;
  /** The `video` resource: snippet and status. */
  metadata: Record<string, unknown>;
  notifySubscribers: boolean;
  signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
  /** Tests make these small. */
  chunkBytes?: number;
  backoffMs?: number[];
};

/** `bytes=0-524287` means the next byte to send is 524288. No header means nothing arrived. */
export function nextOffset(range: string | null): number {
  const match = range?.match(/bytes=\d+-(\d+)/);
  return match ? Number(match[1]) + 1 : 0;
}

/** A request that refreshes the token once when Google answers 401. */
async function authorized(
  client: YouTubeClient,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: RequestInit["body"]; signal?: AbortSignal },
): Promise<Response> {
  const send = async (token: string) =>
    fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  const first = await send(await client.bearer());
  if (first.status !== 401) return first;
  return send(await client.bearer(true));
}

/** Upload a local video and return the new video resource. */
export async function uploadVideoFile(client: YouTubeClient, options: UploadOptions): Promise<VideoResource> {
  const { path, mimeType, signal, onProgress } = options;
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const file = await openAsBlob(path);
  const total = file.size;

  // 1. Start the session.
  const params = new URLSearchParams({
    uploadType: "resumable",
    part: Object.keys(options.metadata).join(","),
    notifySubscribers: String(options.notifySubscribers),
  });
  const started = await authorized(client, `${UPLOAD_BASE}/videos?${params}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(total),
      "X-Upload-Content-Type": mimeType,
    },
    body: JSON.stringify(options.metadata),
    signal,
  });
  if (!started.ok) throw apiError(started.status, await started.text());
  const session = started.headers.get("location");
  if (!session) throw new ApiError("YouTube started the upload but sent no session URI to send the file to.");

  const finished = async (res: Response): Promise<VideoResource> => {
    onProgress?.(total, total);
    return (await res.json()) as VideoResource;
  };
  const expired = () =>
    new ApiError(
      "The upload session expired before the file finished, so YouTube kept nothing. Start the upload again.",
      { details: { reason: "uploadSessionExpired" } },
    );

  // 2. Send the file, chunk by chunk, resuming from wherever YouTube says it is.
  let offset = 0;
  let stalls = 0;
  for (;;) {
    signal?.throwIfAborted();
    let res: Response | undefined;
    const end = Math.min(offset + chunkBytes, total);
    try {
      res = await authorized(client, session, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${end - 1}/${total}` },
        body: file.slice(offset, end),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      res = undefined; // A dropped connection: ask where it stands below.
    }

    if (res) {
      if (res.status === 200 || res.status === 201) return finished(res);
      if (res.status === 308) {
        const next = nextOffset(res.headers.get("range"));
        if (next > offset) {
          stalls = 0;
          offset = next;
          onProgress?.(offset, total);
          continue;
        }
        // Nothing new arrived. Back off and ask, as for a failure, so this cannot spin.
      } else if (res.status === 404) {
        throw expired();
      } else if (!RETRYABLE.has(res.status)) {
        throw apiError(res.status, await res.text());
      }
    }

    // 3. A retryable failure: wait, then ask YouTube how much it has.
    if (stalls >= backoff.length) {
      throw new ApiError(
        `The upload stopped making progress at ${offset} of ${total} bytes after ${backoff.length} retries. YouTube or the network is failing; try again later.`,
        { details: { reason: "uploadStalled", sent: offset, total } },
      );
    }
    await sleep(backoff[stalls]!, undefined, { signal });
    stalls++;
    try {
      const status = await authorized(client, session, {
        method: "PUT",
        headers: { "Content-Range": `bytes */${total}` },
        body: new Uint8Array(0),
        signal,
      });
      if (status.status === 200 || status.status === 201) return finished(status);
      if (status.status === 404) throw expired();
      if (status.status === 308) offset = nextOffset(status.headers.get("range"));
    } catch (error) {
      if (signal?.aborted || error instanceof ApiError) throw error;
      // Still unreachable. The next pass retries the chunk and backs off again.
    }
  }
}

/** Set a custom thumbnail from a local JPEG or PNG. */
export async function setThumbnailFile(
  client: YouTubeClient,
  videoId: string,
  path: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<void> {
  const image = await openAsBlob(path);
  const res = await authorized(
    client,
    `${UPLOAD_BASE}/thumbnails/set?${new URLSearchParams({ videoId, uploadType: "media" })}`,
    { method: "POST", headers: { "Content-Type": mimeType }, body: image, signal },
  );
  if (!res.ok) throw apiError(res.status, await res.text());
}
