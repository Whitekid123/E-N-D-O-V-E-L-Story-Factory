/**
 * Server-side Supabase helpers (service role).
 * Uses fetch so Trigger.dev workers need no extra native deps.
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 */

function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key, enabled: Boolean(url && key) };
}

async function sb(
  path: string,
  init: RequestInit & { prefer?: string } = {}
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const { url, key, enabled } = config();
  if (!enabled) return { ok: false, status: 0, data: null, error: "Supabase not configured" };

  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.prefer) headers.Prefer = init.prefer;

  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: typeof data === "object" && data && "message" in data ? String((data as { message: string }).message) : text || res.statusText,
    };
  }
  return { ok: true, status: res.status, data };
}

export type StoryRow = {
  id: string;
  title: string;
  genre: string;
  total_episodes: number;
  model: string;
  hook: string;
  bible: string;
  blocks: string;
  story_state: string;
};

export type EpisodeRow = {
  story_id: string;
  number: number;
  title: string;
  body: string;
  premium_title: string;
  premium_body: string;
  memory: string;
  hook_type: string;
  episode_words: number;
  premium_words: number;
};

export function isSupabaseConfigured() {
  return config().enabled;
}

export async function upsertStory(row: {
  id?: string;
  title: string;
  genre?: string;
  total_episodes: number;
  model?: string;
  hook?: string;
  bible?: string;
  blocks?: string;
  story_state?: string;
}): Promise<{ id: string } | null> {
  const body = {
    ...(row.id ? { id: row.id } : {}),
    title: row.title,
    genre: row.genre || "",
    total_episodes: row.total_episodes,
    model: row.model || "auto",
    hook: row.hook || "",
    bible: row.bible || "",
    blocks: row.blocks || "",
    story_state: row.story_state || "",
    updated_at: new Date().toISOString(),
  };

  const result = await sb("stories", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    console.error("upsertStory failed", result.error);
    return null;
  }
  const rows = result.data as Array<{ id: string }> | null;
  return rows?.[0] ? { id: rows[0].id } : row.id ? { id: row.id } : null;
}

export async function updateStoryState(storyId: string, storyState: string) {
  const result = await sb(`stories?id=eq.${encodeURIComponent(storyId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({ story_state: storyState, updated_at: new Date().toISOString() }),
  });
  if (!result.ok) console.error("updateStoryState failed", result.error);
  return result.ok;
}

export async function upsertEpisode(ep: EpisodeRow) {
  const result = await sb("episodes", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify({
      story_id: ep.story_id,
      number: ep.number,
      title: ep.title,
      body: ep.body,
      premium_title: ep.premium_title,
      premium_body: ep.premium_body,
      memory: ep.memory,
      hook_type: ep.hook_type,
      episode_words: ep.episode_words,
      premium_words: ep.premium_words,
    }),
  });
  if (!result.ok) console.error("upsertEpisode failed", result.error);
  return result.ok;
}

export async function loadStory(storyId: string): Promise<{ story: StoryRow; episodes: EpisodeRow[] } | null> {
  const s = await sb(`stories?id=eq.${encodeURIComponent(storyId)}&select=*`);
  if (!s.ok) return null;
  const stories = s.data as StoryRow[];
  if (!stories?.[0]) return null;

  const e = await sb(
    `episodes?story_id=eq.${encodeURIComponent(storyId)}&select=*&order=number.asc`
  );
  const episodes = (e.ok ? (e.data as EpisodeRow[]) : []) || [];
  return { story: stories[0], episodes };
}
