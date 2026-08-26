import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import type { generateEpisode } from "@/trigger/generate-episode";
import type { generateEpisodesBatch } from "@/trigger/generate-episodes-batch";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const input = await req.json();
    const count = Math.max(1, Math.min(Number(input.count) || 1, 20));

    if (count > 1) {
      const handle = await tasks.trigger<typeof generateEpisodesBatch>(
        "generate-episodes-batch",
        {
          startEpisode: input.episodeNumber || input.startEpisode,
          count,
          totalEpisodes: input.totalEpisodes,
          model: input.model,
          bible: input.bible,
          blocks: input.blocks,
          storyState: input.storyState,
          memories: input.memories,
          recentHooks: input.recentHooks,
          lastEnding: input.lastEnding,
          fastMode: input.fastMode !== false,
          storyId: input.storyId,
        }
      );

      return NextResponse.json({
        runId: handle.id,
        status: "QUEUED",
        mode: "batch",
        count,
      });
    }

    const handle = await tasks.trigger<typeof generateEpisode>(
      "generate-episode",
      input
    );

    return NextResponse.json({
      runId: handle.id,
      status: "QUEUED",
      mode: "single",
      count: 1,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start generation" },
      { status: 500 }
    );
  }
}
