import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    const run = await runs.retrieve(runId);

    // Normalize status for the frontend
    const status = run.status; // QUEUED | EXECUTING | COMPLETED | FAILED | CANCELED | ...

    if (status === "COMPLETED") {
      return NextResponse.json({
        status: "COMPLETED",
        output: run.output ?? null,
      });
    }

    if (status === "FAILED" || status === "CRASHED" || status === "SYSTEM_FAILURE" || status === "CANCELED") {
      const errorMessage =
        (run as { error?: { message?: string } }).error?.message ||
        `Task ${status.toLowerCase()}`;
      return NextResponse.json({
        status: "FAILED",
        error: errorMessage,
      });
    }

    // Still running
    return NextResponse.json({
      status: status === "QUEUED" || status === "PENDING_VERSION" || status === "DELAYED" ? "QUEUED" : "EXECUTING",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch run status" },
      { status: 500 }
    );
  }
}
