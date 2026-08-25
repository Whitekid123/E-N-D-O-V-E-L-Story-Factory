import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import type { generateEpisode } from "@/trigger/generate-episode";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const input = await req.json();

    const handle = await tasks.trigger<typeof generateEpisode>(
      "generate-episode",
      input
    );

    return NextResponse.json({
      runId: handle.id,
      status: "QUEUED",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start generation" },
      { status: 500 }
    );
  }
}