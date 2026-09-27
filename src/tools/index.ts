/**
 * Every tool, in one array.
 *
 * The MCP server registers this list and the CLI turns the same list into
 * commands, so a tool added here is a tool and a command at once, and the two
 * surfaces cannot drift.
 */

import type { AnyToolSpec } from "./kit.js";
import { transcriptTools } from "./transcripts.js";
import { researchTools } from "./research.js";
import { accountTools } from "./account.js";

export const ALL_TOOLS: AnyToolSpec[] = [...transcriptTools, ...researchTools, ...accountTools];
