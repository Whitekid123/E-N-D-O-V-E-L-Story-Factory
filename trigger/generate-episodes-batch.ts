import { task } from "@trigger.dev/sdk";
import { generateEpisode } from "./generate-episode";
import { isSupabaseConfigured, upsertEpisode, updateStoryState } from "@/lib/supabase-store";

function blockSpec(text: string, n: number): string {
  const m = text.match(new RegExp(`<BLOCK_${n}>([\\s\\S]*?)</BLOCK_${n}>`, "i"));
  return m ? m[1].trim() : "";
}

/**
 * Long-running cloud batch: writes several episodes in sequence.
 * Continues even if the user closes the website.
 * When storyId + Supabase env are set, each episode is saved immediately.
 */
export const generateEpisodesBatch = task({
  id: "generate-episodes-batch",
  maxDuration: 7200,
  run: async (payload: {
    startEpisode: number;
    count: number;
    totalEpisodes: number;
    model: string;
    bible: string;
    blocks: string;
    storyState?: string;
    memories?: string[];
    recentHooks?: string[];
    lastEnding?: string;
    fastMode?: boolean;
    storyId?: string;
  }) => {
    const count = Math.max(1, Math.min(payload.count || 1, 20));
    const start = Math.max(1, payload.startEpisode || 1);
    const storyId = payload.storyId || "";
    const canSave = Boolean(storyId && isSupabaseConfigured());

    const episodes: Array<{
      number: number;
      title: string;
      body: string;
      premiumTitle: string;
      premiumBody: string;
      memory: string;
      hookType: string;
      episodeWords: number;
      premiumWords: number;
    }> = [];

    let state = payload.storyState || "";
    let memories = [...(payload.memories || [])];
    let hooks = [...(payload.recentHooks || [])];
    let lastEnding = payload.lastEnding || "";

    for (let i = 0; i < count; i++) {
      const episodeNumber = start + i;
      if (episodeNumber > payload.totalEpisodes) break;

      const block = Math.floor((episodeNumber - 1) / 10) + 1;
      const spec = blockSpec(payload.blocks, block);

      const result = await generateEpisode.triggerAndWait({
        episodeNumber,
        totalEpisodes: payload.totalEpisodes,
        model: payload.model,
        bible: payload.bible,
        blockSpec: spec,
        storyState: state,
        memories: memories.slice(-3),
        recentHooks: hooks.slice(-3),
        lastEnding,
        fastMode: payload.fastMode !== false,
      });

      if (!result.ok) {
        const errMsg =
          typeof result.error === "string"
            ? result.error
            : (result.error as { message?: string })?.message || "unknown error";
        return {
          episodes,
          state,
          stoppedAt: episodeNumber,
          error: `Episode ${episodeNumber} failed: ${errMsg}`,
          partial: true,
          savedToSupabase: canSave,
        };
      }

      const out = result.output;
      episodes.push({
        number: episodeNumber,
        title: out.title,
        body: out.body,
        premiumTitle: out.premiumTitle,
        premiumBody: out.premiumBody,
        memory: out.memory,
        hookType: out.hookType,
        episodeWords: out.episodeWords,
        premiumWords: out.premiumWords,
      });

      state = out.state || state;
      memories = [...memories, `Ep${episodeNumber}: ${out.memory}`].slice(-5);
      hooks = [...hooks, out.hookType].slice(-5);
      lastEnding = (out.body || "").slice(-1800);

      if (canSave) {
        await upsertEpisode({
          story_id: storyId,
          number: episodeNumber,
          title: out.title,
          body: out.body,
          premium_title: out.premiumTitle,
          premium_body: out.premiumBody,
          memory: out.memory,
          hook_type: out.hookType,
          episode_words: out.episodeWords,
          premium_words: out.premiumWords,
        });
        await updateStoryState(storyId, state);
      }
    }

    return {
      episodes,
      state,
      partial: false,
      savedToSupabase: canSave,
      storyId: storyId || null,
    };
  },
});
