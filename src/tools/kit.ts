/**
 * The seam every tool goes through, now on Slipway.
 *
 * Tools are declared as data rather than registered by hand so that guarding,
 * annotations and error shaping happen in exactly one place, and that place is
 * now the framework: this adapter turns each declaration into a Slipway tool,
 * which serves both the MCP server and the CLI.
 */

import {
  ApiError,
  NotConfiguredError,
  NotFoundError,
  RateLimitError,
  SlipwayError,
  httpError,
  toSlipwayError,
  toolkit,
  z,
  type Risk,
  type Tool,
} from "@thenavidm/slipway";
import type { Config } from "../config.js";
import { resolveAccount } from "../config.js";
import { YouTubeApiError, YouTubeClient } from "../youtube/api.js";
import { TranscriptError } from "../youtube/transcripts.js";

export type ToolContext = {
  config: Config;
  /** A client bound to the requested channel, or to the API key when none is asked for. */
  clientFor: (accountHint?: string) => YouTubeClient;
};

const kit = toolkit<ToolContext>();

type Shape = Record<string, z.ZodType>;

export type ToolSpec<S extends Shape> = {
  name: string;
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  idempotent?: boolean;
  /** One line describing what the call is about to do, for the confirm message and the audit log. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<string>;
};

export type AnyToolSpec = Tool<ToolContext>;

/**
 * Google sends a used-up quota or a rate limit as a 403, so its reason
 * (`quotaExceeded`, `rateLimitExceeded`, `userRateLimitExceeded` and the other
 * `...LimitExceeded`) decides before the status can read it as a rejected
 * credential. A transcript that does not
 * exist is not found, YouTube refusing this IP for a while is rate limited, as
 * in 2.0, and yt-dlp not installed is setup still to do, exit 10. A plain
 * failure from Google or yt-dlp is upstream, exit 5, as in 2.0; a bug in this
 * code stays exit 1.
 */
export function toSlipway(error: unknown): unknown {
  if (error instanceof SlipwayError) return error;
  if (error instanceof YouTubeApiError) {
    const known = /quota|limitexceeded/i.test(error.reason ?? "") ? new RateLimitError(error.message) : httpError(error.status, error.message);
    return new SlipwayError(known.message, known.code, known.exitCode, {
      ...(known.hint ? { hint: known.hint } : {}),
      status: error.status,
      ...(error.reason ? { details: { reason: error.reason } } : {}),
      cause: error,
    });
  }
  if (error instanceof TranscriptError) {
    const options = { cause: error, details: { reason: error.code } };
    if (error.code === "no_video" || error.code === "no_captions" || error.code === "language_missing") return new NotFoundError(error.message, options);
    if (error.code === "rate_limited") return new RateLimitError(error.message, options);
    if (error.code === "no_ytdlp") return new NotConfiguredError(error.message, options);
    return new ApiError(error.message, options);
  }
  if (error instanceof Error && error.constructor === Error) {
    const known = toSlipwayError(error);
    return known.code === "internal" ? new ApiError(error.message, { cause: error }) : known;
  }
  return error;
}

export function defineTool<S extends Shape>(spec: ToolSpec<S>): Tool<ToolContext> {
  const { confirm: _confirm, ...shape } = spec.schema as Shape;
  const handler = spec.handler as (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  return kit.defineTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: z.object(shape),
    risk: spec.risk,
    ...(spec.idempotent !== undefined ? { idempotent: spec.idempotent } : {}),
    ...(spec.summary ? { summary: spec.summary as (args: Record<string, unknown>) => string } : {}),
    handler: async (args, ctx) => {
      try {
        return await handler(args, ctx);
      } catch (error) {
        throw toSlipway(error);
      }
    },
  });
}

export function makeContext(config: Config): ToolContext {
  return {
    config,
    clientFor: (hint?: string) => new YouTubeClient({ apiKey: config.apiKey, account: resolveAccount(config, hint) }),
  };
}

/** Clamp a caller-supplied limit into a range the Data API will accept. */
export function clamp(value: number | undefined, fallback: number, max = 50): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
