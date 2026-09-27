import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Point the channel store at an empty scratch directory, so channels saved
    // by a real `youtube-cli login` on this machine never leak into a test.
    env: { YOUTUBE_MCP_HOME: "/tmp/youtube-mcp-cli-test-home" },
  },
});
