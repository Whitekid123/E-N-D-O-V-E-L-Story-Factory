import { NextResponse } from "next/server";
import { loadStory, upsertStory, isSupabaseConfigured } from "@/lib/supabase-store";

export const runtime = "nodejs";

/** Create or update a story row; returns { id } */
export async function POST(req: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured on the server" },
        { status: 503 }
      );
    }

    const body = await req.json();
    const saved = await upsertStory({
      id: body.id,
      title: body.title,
      genre: body.genre,
      total_episodes: body.total_episodes || body.episodes || 100,
      model: body.model,
      hook: body.hook,
      bible: body.bible,
      blocks: body.blocks,
      story_state: body.story_state || body.state,
    });

    if (!saved?.id) {
      return NextResponse.json({ error: "Failed to save story" }, { status: 500 });
    }

    return NextResponse.json({ id: saved.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Story save failed" },
      { status: 500 }
    );
  }
}

/** Load story + episodes by id: GET /api/story?id=... */
export async function GET(req: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "Supabase is not configured on the server" },
        { status: 503 }
      );
    }

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const data = await loadStory(id);
    if (!data) {
      return NextResponse.json({ error: "Story not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: data.story.id,
      meta: {
        title: data.story.title,
        genre: data.story.genre,
        episodes: data.story.total_episodes,
        model: data.story.model,
      },
      hook: data.story.hook,
      bible: data.story.bible,
      blocks: data.story.blocks,
      state: data.story.story_state,
      eps: data.episodes.map((e) => ({
        number: e.number,
        title: e.title,
        body: e.body,
        premiumTitle: e.premium_title,
        premiumBody: e.premium_body,
        memory: e.memory,
        hookType: e.hook_type,
        episodeWords: e.episode_words,
        premiumWords: e.premium_words,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Story load failed" },
      { status: 500 }
    );
  }
}
