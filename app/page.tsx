'use client';

import React, { ChangeEvent, useEffect, useRef, useState } from 'react';

type Episode = { number: number; title: string; body: string; premiumTitle: string; premiumBody: string; memory: string; hookType: string; episodeWords: number; premiumWords: number };
type Story = { meta: { title: string; genre: string; episodes: number; model: string }; hook: string; bible: string; blocks: string; state: string; eps: Episode[] };
type QCReport = { verdict: string; summary: string; episodes: Array<{ number: number; title: string; score?: number; issues: string[] }>; crossEpisode: string[]; fixes: Array<{ episode: number; problem: string; instruction: string }> };

const KEY = 'endovel-story-v1';
const MODELS = [['auto', 'auto — smart routing (cheapest)'], ['Kimi-K2.6', 'Kimi-K2.6 — best creative writer (svip)'], ['glm-5.2', 'glm-5.2 — strongest flagship'], ['DeepSeek-V4-Pro', 'DeepSeek-V4-Pro — fast + strong (paid tier)'], ['MiniMax-M3', 'MiniMax-M3 — strong, cheaper'], ['glm-4.5-air', 'glm-4.5-air — light & fast']];

const blockSpec = (text: string, n: number) => text.match(new RegExp(`<BLOCK_${n}>([\\s\\S]*?)</BLOCK_${n}>`, 'i'))?.[1].trim() || '';
const slug = (t: string) => t.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 50) || 'story';
const stripPreview = (t: string, close: string) => t.split(close)[0].replace(/<\/?[A-Z][A-Z_]*>/g, '');
const countWords = (t: string) => (t.trim().match(/\S+/g) || []).length;
const genreTags = (bible: string, fallback: string) => {
  const m = bible.match(/genre\s*tags?\s*[:：]\s*([^\n]+)/i) || bible.match(/^\s*genre(?:\s*\/\s*subgenre)?\s*[:：]\s*([^\n]+)/im);
  const raw = (m ? m[1] : fallback || '').trim().replace(/[.;]+$/, '');
  return raw ? raw.split(/\s*[,/·|]\s*/).filter(Boolean).map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' • ') : '';
};
const download = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };

function ModelTester({ model, disabled }: { model: string; disabled?: boolean }) {
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const test = async () => {
    if (!model.trim()) { setMsg({ ok: false, text: 'Pick or type a model name first.' }); return; }
    setTesting(true); setMsg(null);
    try {
      const res = await fetch('/api/test-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'Test failed');
      setMsg({ ok: true, text: `Works ✓ — ${(d.ttftMs / 1000).toFixed(1)}s response${d.wps ? `, ~${d.wps} words/sec` : ''}. Sample: "${d.sample}"` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  };
  return (
    <div>
      <button type="button" onClick={test} disabled={testing || disabled} className="btn btn-ghost !py-1.5 !text-xs">{testing ? 'Testing… (~15s)' : 'Test this model'}</button>
      {msg && <p className={`text-xs mt-2 leading-relaxed rounded-xl border p-3 ${msg.ok ? 'border-emerald-900/60 text-emerald-200' : 'border-red-900/60 text-red-200'}`}>{msg.text}</p>}
    </div>
  );
}

function ModelPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const known = MODELS.some(([id]) => id === value);
  return (
    <div className="space-y-2">
      <select value={known ? value : '__custom__'} onChange={(e) => onChange(e.target.value === '__custom__' ? '' : e.target.value)} disabled={disabled} className="field cursor-pointer">
        {MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        <option value="__custom__">Other — type a model name…</option>
      </select>
      {!known && <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="Exact gateway model name" className="field" />}
      <ModelTester model={value} disabled={disabled} />
      <p className="text-[11px] text-cream-600 leading-relaxed">The model writes your episodes. Test it first to check access and speed; switching later only affects future episodes.</p>
      <div className="bg-ink-950 border border-line rounded-xl p-3 text-[11px] text-cream-500 leading-relaxed"><b className="text-gold-300">Workflow:</b> Create Bible & Plan → review the documents → Write episodes → run QC → download the Word file and project backup.</div>
    </div>
  );
}

export default function Home() {
  const [story, setStory] = useState<Story | null>(null);
  const ref = useRef<Story | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLPreElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(['Ready.']);
  const [live, setLive] = useState('');
  const [premiumLive, setPremiumLive] = useState('');
  const [qc, setQc] = useState<QCReport | null>(null);
  const [qcBlock, setQcBlock] = useState('1');
  const [qcBusy, setQcBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [fast, setFast] = useState(false);
  const [count, setCount] = useState('10');

  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [episodes, setEpisodes] = useState('100');
  const [model, setModel] = useState('auto');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { const parsed = JSON.parse(raw) as Story; const saved = { ...parsed, state: parsed.state || '', eps: parsed.eps || [] }; ref.current = saved; setStory(saved); } catch { /* ignore */ }
    }
    try { setFast(localStorage.getItem('endovel-fast') === '1'); } catch {}
    try { const c = localStorage.getItem('endovel-count'); if (c) setCount(c); } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem('endovel-fast', fast ? '1' : '0'); } catch {} }, [fast]);
  useEffect(() => { try { localStorage.setItem('endovel-count', count); } catch {} }, [count]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  useEffect(() => { if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight; }, [live, premiumLive]);

  const addLog = (m: string) => setLog((items) => [...items, m]);
  const update = (next: Story) => { ref.current = next; setStory(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { addLog('⚠ Browser storage full — download a project backup now.'); } };
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const create = async () => {
    if (!title.trim()) { addLog('Enter a story title first.'); return; }
    setBusy(true);
    const total = Math.max(10, parseInt(episodes, 10) || 100);
    const meta = { title: title.trim(), genre: genre.trim(), episodes: total, model: model || 'auto' };
    try {
      addLog(`Creating the story bible for "${meta.title}"... (1–3 min)`);
      const bible = await post('/api/bible', { ...meta, notes });
      const first: Story = { meta, hook: bible.hook || '', bible: bible.bible, blocks: '', state: '', eps: [] };
      update(first);
      addLog('Bible ready ✓  Now planning all blocks... (1–3 min)');
      const plan = await post('/api/blocks', { bible: first.bible, episodes: total, model: meta.model });
      update({ ...first, blocks: plan.blocks });
      addLog(`Master plan ready — ${Math.ceil(total / 10)} blocks. Set your episode count and press Write.`);
    } catch (e) { addLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const rebuildPlan = async () => {
    const cur = ref.current; if (!cur) return;
    setBusy(true);
    try {
      addLog('Planning all blocks... (1–3 min)');
      const data = await post('/api/blocks', { bible: cur.bible, episodes: cur.meta.episodes, model: cur.meta.model });
      update({ ...cur, blocks: data.blocks });
      addLog('Block plan rebuilt ✓');
    } catch (e) { addLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const buildDocx = async (n: number) => {
    const cur = ref.current; if (!cur) return;
    const list = cur.eps.filter((e) => Math.floor((e.number - 1) / 10) + 1 === n);
    if (!list.length) return;
    const spec = blockSpec(cur.blocks, n);
    const res = await fetch('/api/docx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyTitle: cur.meta.title,
        storyGenre: genreTags(cur.bible, cur.meta.genre),
        blockNumber: n,
        blockTitle: spec.match(/BLOCK\s+\d+\s*:\s*(.+)/i)?.[1] || `Block ${n}`,
        blockDescription: spec.match(/PURPOSE:\s*([^\n]+)/i)?.[1] || '',
        episodes: list,
      }),
    });
    if (!res.ok) throw new Error('Word file build failed');
    download(await res.blob(), `${slug(cur.meta.title)}_Block_${n}.docx`);
    addLog(`📄 Block ${n} manuscript downloaded.`);
  };

  const write = async (amount: number) => {
    stopRef.current = false;
    setBusy(true);
    try {
      for (let i = 0; i < amount; i += 1) {
        if (stopRef.current) { addLog('Stopped — click Write again later to resume.'); break; }
        const cur = ref.current; if (!cur) break;
        const number = cur.eps.length + 1;
        if (number > cur.meta.episodes) { addLog('🎉 Story complete — every episode written.'); break; }
        const block = Math.floor((number - 1) / 10) + 1;
        
        let success = false;
        let attempts = 0;
        let lastError = '';

        while (!success && attempts < 3) {
          attempts += 1;
          if (stopRef.current) break;

          try {
            setLive(''); setPremiumLive('');
            if (attempts > 1) {
              addLog(`[Attempt ${attempts}/3] Retrying Episode ${number}...`);
            } else {
              addLog(`Writing Episode ${number} of ${cur.meta.episodes} (Block ${block})...`);
            }

            const res = await fetch('/api/episode', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                episodeNumber: number, totalEpisodes: cur.meta.episodes, model: cur.meta.model,
                bible: cur.bible, blockSpec: blockSpec(cur.blocks, block), storyState: cur.state,
                memories: cur.eps.slice(-3).map((e) => `Ep${e.number}: ${e.memory}`),
                recentHooks: cur.eps.slice(-3).map((e) => e.hookType),
                lastEnding: cur.eps.at(-1)?.body.slice(-1800) || '',
                fastMode: fast,
              }),
            });

            if (!res.ok) {
              let errorMsg = `Server error: ${res.status}`;
              try {
                const errData = await res.json();
                if (errData.error) errorMsg = errData.error;
              } catch {
                if (res.status === 504) errorMsg = 'Server timeout (generation took too long).';
              }
              throw new Error(errorMsg);
            }
            if (!res.body) throw new Error('No stream returned');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            let final: (Episode & { state: string }) | null = null;
            let err = '';

            while (true) {
              const part = await reader.read();
              if (part.done) break;
              buf += decoder.decode(part.value, { stream: true });
              let nl = buf.indexOf('\n');
              while (nl >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                nl = buf.indexOf('\n');
                if (!line) continue;
                try {
                  const ev = JSON.parse(line) as { type: string; text?: string; message?: string; data?: Episode & { state: string } };
                  if (ev.type === 'ping') continue;
                  if (ev.type === 'status') addLog(ev.message || '');
                  else if (ev.type === 'chunk') setLive((t) => t + (ev.text || ''));
                  else if (ev.type === 'body') setLive(ev.text || '');
                  else if (ev.type === 'premium_reset') setPremiumLive('');
                  else if (ev.type === 'premium_chunk') setPremiumLive((t) => t + (ev.text || ''));
                  else if (ev.type === 'done') final = ev.data || null;
                  else if (ev.type === 'error') err = ev.message || 'Generation failed';
                } catch { /* incomplete line */ }
              }
            }

            if (err) throw new Error(err);
            if (!final) throw new Error('Stream ended without a result.');

            const ep: Episode = { number, title: final.title, body: final.body, premiumTitle: final.premiumTitle, premiumBody: final.premiumBody, memory: final.memory, hookType: final.hookType, episodeWords: final.episodeWords, premiumWords: final.premiumWords };
            update({ ...cur, eps: [...cur.eps, ep], state: final.state || cur.state });
            addLog(`Episode ${number} done ✓  ${final.episodeWords} words + premium ${final.premiumWords} words. Memory updated.`);

            if (number % 10 === 0 || number === cur.meta.episodes) await buildDocx(block);
            
            success = true; 

          } catch (err: any) {
            lastError = err.message || String(err);
            if (attempts < 3 && !stopRef.current) {
               addLog(`WARNING: ${lastError} - Retrying in 5 seconds...`);
               await new Promise((r) => setTimeout(r, 5000));
            }
          }
        }

        if (!success) {
          throw new Error(`Failed to generate Episode ${number} after 3 attempts. Last error: ${lastError}`);
        }
      }
    } catch (e) { addLog(`ERROR: ${e instanceof Error ? e.message : String(e)} — progress saved; click Write to resume.`); }
    finally { setBusy(false); setLive(''); setPremiumLive(''); }
  };

  const rewrite = async () => {
    const cur = ref.current;
    if (!cur?.eps.length || busy || !confirm(`Delete Episode ${cur.eps.length} and write a fresh version? Earlier episodes stay untouched.`)) return;
    update({ ...cur, eps: cur.eps.slice(0, -1) });
    setSelected(null);
    await write(1);
  };

  const rewind = () => {
    const cur = ref.current; if (!cur || busy) return;
    const input = prompt(`REWIND — delete episodes back to a chosen point.\n\nEnter how many episodes to KEEP (0 to ${cur.eps.length}).\nExample: 12 → episodes 13+ are deleted and rewritten next.\n0 deletes all episodes (bible & plan are kept).\n\nTip: download a project backup first.`, String(Math.max(0, cur.eps.length - 1)));
    if (input === null) return;
    const amount = Math.max(0, Math.min(cur.eps.length, parseInt(input, 10) || 0));
    update({ ...cur, eps: cur.eps.slice(0, amount) });
    setSelected(null);
    addLog(`Rewound — kept episodes 1–${amount}.`);
  };

  const rebuildMemory = async () => {
    const cur = ref.current; if (!cur?.eps.length || busy) return;
    setBusy(true);
    try {
      addLog('Rebuilding story memory from all episodes... (1–3 min)');
      const data = await post('/api/state', { bible: cur.bible, eps: cur.eps, model: cur.meta.model });
      update({ ...cur, state: data.state });
      addLog('Story memory rebuilt ✓');
    } catch (e) { addLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const runQC = async () => {
    const cur = ref.current; if (!cur || busy || qcBusy) return;
    const list = cur.eps.filter((e) => Math.floor((e.number - 1) / 10) + 1 === parseInt(qcValue, 10));
    if (!list.length) return;
    setQcBusy(true); setQc(null);
    addLog(`Running quality check on Block ${qcValue}... (2–4 min)`);
    try {
      const data = await post('/api/qc', { model: cur.meta.model, bible: cur.bible, storyState: cur.state, blockSpec: blockSpec(cur.blocks, parseInt(qcValue, 10)), blockNumber: parseInt(qcValue, 10), episodes: list });
      setQc(data.report);
      addLog(`QC complete — Block ${qcValue}: ${data.report.verdict}.`);
    } catch (e) { addLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setQcBusy(false); }
  };

  const backup = () => { const cur = ref.current; if (cur) download(new Blob([JSON.stringify({ version: 3, ...cur }, null, 2)], { type: 'application/json' }), `${slug(cur.meta.title)}_project_backup.json`); };

  const importProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as Story;
        if (!imported?.meta?.title || !imported.bible || !Array.isArray(imported.eps)) throw new Error('invalid');
        if (!confirm(`Load project "${imported.meta.title}" (${imported.eps.length} episodes)? This REPLACES the story currently in this browser. Download a backup of your current story first if you want to keep it.`)) return;
        update({ ...imported, state: imported.state || '' });
        setSelected(null);
        addLog(`Project "${imported.meta.title}" imported ✓`);
      } catch { addLog('Import failed — that file is not a valid project backup.'); }
    };
    reader.readAsText(file);
  };

  const copy = async (label: string, text: string) => { try { await navigator.clipboard.writeText(text); addLog(`📋 ${label} copied.`); } catch { addLog('Copy failed — select the text manually.'); } };
  const startNew = () => { if (confirm('Delete this story and start a new one?\n\nDownloaded files are safe. Download a project backup first if you might want this story later.')) { localStorage.removeItem(KEY); ref.current = null; setStory(null); setQc(null); setLog(['Ready for a new story.']); } };

  // ---------- setup screen ----------
  if (!story) {
    return (
      <main className="app-bg flex items-center justify-center p-6">
        <div className="w-full max-w-xl fade-up">
          <div className="text-center mb-6">
            <div className="text-[11px] font-semibold tracking-[0.35em] text-gold-400 mb-3">E N D O V E L</div>
            <h1 className="font-display text-5xl text-cream-100">Story Factory</h1>
            <p className="text-cream-500 mt-3 text-sm">Type a title, plan the novel, then write it episode by episode.</p>
          </div>
          <div className="card p-6 md:p-8 space-y-4">
            <div><label className="lbl">Story Title *</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Married to the Mafia King" className="field text-base" /></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2"><label className="lbl">Genre (optional)</label><input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="AI picks if empty" className="field" /></div>
              <div><label className="lbl">Episodes</label><input value={episodes} onChange={(e) => setEpisodes(e.target.value.replace(/\D/g, ''))} className="field" /></div>
            </div>
            <div><label className="lbl">Model</label><ModelPicker value={model} onChange={setModel} disabled={busy} /></div>
            <div><label className="lbl">Extra ideas (optional)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything specific you want in the story — otherwise the AI invents freely." className="field" /></div>
            <button onClick={create} disabled={busy} className="btn btn-primary">{busy ? 'Creating Bible & Block Plan… (2–5 min)' : 'Create Story Bible & Block Plan'}</button>
            <button onClick={() => fileRef.current?.click()} className="text-gold-400 hover:text-gold-300 underline mx-auto block text-xs">Import project backup instead</button>
            <input ref={fileRef} type="file" accept=".json" onChange={importProject} className="hidden" />
          </div>
          <div className="card p-4 mt-5">
            <div className="sec mb-2">Activity</div>
            <pre ref={logRef} className="text-xs text-cream-500 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">{log.join('\n')}</pre>
          </div>
        </div>
      </main>
    );
  }

  // ---------- workspace ----------
  const written = story.eps.length;
  const total = story.meta.episodes;
  const totalBlocks = Math.ceil(total / 10);
  const currentBlock = Math.min(totalBlocks, Math.floor(written / 10) + 1);
  const blockEnd = Math.min(currentBlock * 10, total);
  const latest = story.eps.at(-1);
  const reading = story.eps.find((e) => e.number === selected) || latest;
  const readingIndex = reading ? story.eps.findIndex((e) => e.number === reading.number) : -1;
  const previous = readingIndex > 0 ? story.eps[readingIndex - 1] : null;
  const next = readingIndex >= 0 && readingIndex < written - 1 ? story.eps[readingIndex + 1] : null;
  const writtenBlocks = Array.from(new Set(story.eps.map((e) => Math.floor((e.number - 1) / 10) + 1))).sort((a, b) => a - b);
  const qcValue = writtenBlocks.some((b) => String(b) === qcBlock) ? qcBlock : String(writtenBlocks[0] ?? 1);
  const planned = Math.max(1, Math.min(parseInt(count, 10) || 1, Math.max(1, total - written)));
  const pill = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${active ? 'border-gold-500 bg-gold-500/15 text-gold-300' : 'border-line text-cream-500 hover:text-cream-300'}`;

  return (
    <main className="app-bg p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6 fade-up">
          <div className="sec">{story.meta.genre || 'Serialized Novel'}</div>
          <h1 className="font-display text-4xl text-cream-100">{story.meta.title}</h1>
          {story.hook && <p className="font-display italic text-cream-500 mt-2">{story.hook}</p>}
          <div className={`bar mt-5 ${busy ? 'busy' : ''}`}><i style={{ width: `${(written / total) * 100}%` }} /></div>
        </header>

        <section className="card border-gold-600/30 p-5 mb-6 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="sec">Next step</div>
            <h2 className="font-display text-xl text-cream-100 mt-1">{!story.blocks ? 'Create the block plan' : written < total ? (written === 0 ? 'Write Block 1' : `Continue writing — Episode ${written + 1} is next`) : 'Your novel is finished 🎉'}</h2>
            <p className="text-sm text-cream-500 mt-1 leading-relaxed">{!story.blocks ? 'The bible is ready; the plan decides what may happen in each block. Writing can\'t start without it.' : written < total ? `${total - written} episode${total - written === 1 ? '' : 's'} left in the novel · ${blockEnd - written} until Block ${currentBlock}\'s Word file downloads. Each episode takes 3–8 minutes and includes its premium mini story.` : 'Download your project backup — your whole novel in one file.'}</p>
          </div>
          <button onClick={!story.blocks ? rebuildPlan : written < total ? () => write(planned) : backup} disabled={busy} className="btn btn-primary md:w-64 shrink-0">{busy ? 'Writing…' : !story.blocks ? 'Generate Block Plan' : written < total ? `Write ${planned} Episode${planned > 1 ? 's' : ''}` : 'Download Backup'}</button>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="card p-5 space-y-4 h-fit">
            <div className="sec">Control</div>
            <ModelPicker value={story.meta.model} onChange={(value) => update({ ...story, meta: { ...story.meta, model: value || 'auto' } })} disabled={busy} />

            {story.blocks && written < total && (
              <>
                <div>
                  <label className="lbl">Episodes per run</label>
                  <div className="flex flex-wrap gap-1.5">
                    {['1', '2', '3', '5', '10'].map((n) => <button key={n} type="button" onClick={() => setCount(n)} className={pill(count === n)}>{n}</button>)}
                  </div>
                </div>
                <label className="flex items-start gap-2.5 text-xs text-cream-400 cursor-pointer leading-relaxed">
                  <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} className="accent-[#c9963f] w-4 h-4 mt-0.5 shrink-0 cursor-pointer" />
                  <span><b className="text-cream-200">Fast mode</b> — skips the continuity pass and runs steps in parallel: roughly 40% faster per episode. Great while drafting; turn it OFF for final polished blocks.</span>
                </label>
                <button onClick={() => write(1)} disabled={busy} className="btn btn-ghost">Write next episode only</button>
              </>
            )}
            {busy && <button onClick={() => { stopRef.current = true; addLog('Stopping after the current episode…'); }} className="btn btn-danger">Stop after current episode</button>}

            {written > 0 && (
              <div className="border-t border-line pt-4 space-y-2">
                <div className="sec">Episode Tools</div>
                <button onClick={rewrite} disabled={busy} className="btn btn-ghost">Rewrite last episode</button>
                <button onClick={rebuildMemory} disabled={busy} className="btn btn-ghost">Rebuild story memory</button>
                <button onClick={rewind} disabled={busy} className="btn btn-ghost">Rewind / delete episodes</button>
              </div>
            )}

            {written > 0 && (
              <div className="border-t border-line pt-4 space-y-2">
                <div className="sec">Quality Check</div>
                <div className="flex gap-2">
                  <select value={qcValue} onChange={(e) => setQcBlock(e.target.value)} className="field flex-1">
                    {writtenBlocks.map((b) => <option key={b} value={b}>Block {b}</option>)}
                  </select>
                  <button onClick={runQC} disabled={busy || qcBusy} className="btn btn-ghost flex-none px-4">{qcBusy ? 'Checking…' : 'Run QC'}</button>
                </div>
              </div>
            )}

            <div className="border-t border-line pt-4 space-y-2">
              <div className="sec">Data</div>
              <button onClick={backup} disabled={busy} className="btn btn-ghost">Download project backup</button>
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-ghost">Import project file</button>
              <input ref={fileRef} type="file" accept=".json" onChange={importProject} className="hidden" />
              <button onClick={startNew} disabled={busy} className="btn text-cream-600 hover:text-red-300 !border-transparent text-xs py-2">Start a new story</button>
            </div>
          </section>

          <section className="card p-5 lg:col-span-2 h-fit">
            <div className="flex items-center gap-2 mb-3">
              <div className="sec">Activity</div>
              {busy && <span className="pulse-dot ml-auto" />}
            </div>
            <pre ref={logRef} className="bg-ink-950 border border-line p-3 rounded-xl text-xs text-cream-500 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">{log.slice(-16).join('\n')}</pre>
            {written > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {writtenBlocks.map((b) => (
                  <button key={b} onClick={() => buildDocx(b)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border border-gold-500/40 text-gold-300 hover:border-gold-400 transition disabled:opacity-50">Block {b} ⤓</button>
                ))}
              </div>
            )}
          </section>
        </div>

        {busy && (live || premiumLive) && (
          <section className="card border-gold-600/40 p-6 mt-6 fade-up">
            <div className="flex items-center gap-3 mb-4">
              <span className="pulse-dot" />
              <div className="sec !text-cream-300">Writing live · {countWords(stripPreview(live, '</BODY>')).toLocaleString()} words</div>
            </div>
            <div ref={liveRef} className="max-h-96 overflow-y-auto">
              {live && <div className="manuscript drop-cap text-cream-300/90">{stripPreview(live, '</BODY>')}<span className="caret" /></div>}
              {premiumLive && (
                <div className="mt-6 border-l-2 border-gold-600 pl-5">
                  <div className="sec mb-2">Premium Mini Story</div>
                  <div className="manuscript text-cream-300/90">{stripPreview(premiumLive, '</PREMIUM_BODY>')}</div>
                </div>
              )}
            </div>
          </section>
        )}

        {qc && (
          <section className="card p-6 mt-6 fade-up">
            <div className="flex items-center gap-3">
              <div className="font-display text-2xl text-cream-100">Quality Report</div>
              <span className={`chip ${(qc.verdict || '').toUpperCase() === 'PASS' ? 'chip-ok' : 'chip-bad'}`}>{qc.verdict}</span>
            </div>
            <p className="text-sm text-cream-300 my-3 max-w-3xl leading-relaxed">{qc.summary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {qc.episodes.map((e) => {
                const s = e.score ?? -1;
                return (
                  <div key={e.number} className="bg-ink-950 border border-line rounded-xl p-4 flex gap-4">
                    <div className={`font-display text-3xl shrink-0 w-12 text-right ${s >= 85 ? 'text-emerald-300' : s >= 70 ? 'text-gold-300' : s >= 0 ? 'text-red-300' : 'text-cream-600'}`}>{s >= 0 ? s : '—'}</div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-cream-100 truncate">Ep {e.number} · {e.title}</div>
                      <p className="text-xs text-cream-500 mt-1">{e.issues?.join('; ') || 'No issues flagged.'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {qc.fixes?.length > 0 && (
              <div className="mt-4">
                <div className="sec mb-2 !text-red-300">Recommended Fixes</div>
                {qc.fixes.map((f, i) => (
                  <div key={i} className="bg-red-950/20 border border-red-900/40 rounded-xl p-3 text-xs mb-2">
                    <b className="text-red-300">Episode {f.episode}:</b> <span className="text-cream-300">{f.problem}</span>
                    <div className="text-cream-500 italic mt-1">→ {f.instruction}</div>
                  </div>
                ))}
                <p className="text-xs text-cream-600">To apply: Rewind to before that episode, paste the fix into the Story Bible editor, then write again.</p>
              </div>
            )}
          </section>
        )}

        {written > 0 && (
          <section className="card p-5 mt-6">
            <div className="flex justify-between mb-3">
              <div className="sec">Episode Library · {written}</div>
              <span className="text-xs text-cream-600">click any episode to read it below</span>
            </div>
            <div className="max-h-80 overflow-y-auto border border-line rounded-xl">
              {[...story.eps].reverse().map((e) => (
                <button key={e.number} onClick={() => setSelected(e.number)} className={`w-full flex gap-3 px-4 py-3 text-left border-b border-line ${reading?.number === e.number ? 'bg-gold-500/10 border-l-2 border-gold-500' : 'hover:bg-ink-800 border-l-2 border-transparent'}`}>
                  <span className="text-xs text-cream-600 w-20 shrink-0">Ep {e.number}</span>
                  <span className="flex-1 truncate text-sm text-cream-100">{e.title}</span>
                  <span className="text-xs text-cream-600 shrink-0">{e.episodeWords}w</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {reading && (
          <article className="card p-6 md:p-10 mt-6 fade-up">
            <header className="text-center mb-7">
              <div className="text-[11px] font-semibold tracking-[0.35em] text-gold-500">BLOCK {Math.floor((reading.number - 1) / 10) + 1} · EPISODE {reading.number}</div>
              <h2 className="font-display text-4xl text-cream-100 mt-2">{reading.title}</h2>
              <div className="flex justify-center gap-2 mt-3 flex-wrap">
                <span className={`chip ${reading.episodeWords >= 1900 ? 'chip-ok' : 'chip-bad'}`}>{reading.episodeWords.toLocaleString()} words</span>
                <span className={`chip ${reading.premiumWords >= 450 ? 'chip-ok' : 'chip-bad'}`}>Premium · {reading.premiumWords.toLocaleString()}</span>
              </div>
              <div className="flex justify-center gap-2 mt-5 flex-wrap">
                <button onClick={() => previous && setSelected(previous.number)} disabled={!previous} className="btn btn-ghost !w-auto px-3">← Ep {previous ? previous.number : ''}</button>
                <button onClick={() => copy('Episode', `EPISODE ${reading.number}: ${reading.title}\n\n${reading.body}`)} className="btn btn-ghost !w-auto px-3">Copy episode</button>
                <button onClick={() => copy('Premium story', `PREMIUM MINI STORY: ${reading.premiumTitle}\n\n${reading.premiumBody}`)} className="btn btn-ghost !w-auto px-3">Copy premium</button>
                <button onClick={() => next && setSelected(next.number)} disabled={!next} className="btn btn-ghost !w-auto px-3">Ep {next ? next.number : ''} →</button>
              </div>
              {reading.number !== latest?.number && (
                <p className="text-xs text-cream-600 mt-4">Reading an older episode — <button onClick={() => setSelected(latest!.number)} className="text-gold-400 underline underline-offset-2 cursor-pointer">jump to latest (Ep {latest!.number})</button></p>
              )}
            </header>
            <div className="manuscript drop-cap mx-auto">{reading.body}</div>
            <div className="max-w-3xl mx-auto mt-10 border-l-2 border-gold-600/50 bg-ink-850/50 rounded-r-2xl p-6">
              <div className="sec mb-2">Premium Mini Story</div>
              <h3 className="font-display text-xl mb-4 text-cream-100">{reading.premiumTitle}</h3>
              <div className="manuscript">{reading.premiumBody}</div>
            </div>
          </article>
        )}

        <div className="space-y-4 mt-6">
          {([['Story Memory — the living state (auto-updated every episode; edit freely)', 'state'], ['Story Bible (the novel\'s rulebook — edits change all future episodes)', 'bible'], ['Block Plan (what may happen in each block — edits affect future episodes)', 'blocks']] as const).map(([label, field]) => (
            <details key={field} className="card p-5">
              <summary className="text-sm font-semibold text-cream-300 hover:text-cream-100 transition-colors"><span className="chev text-gold-500">›</span> {label}</summary>
              {story[field] ? <textarea rows={16} value={story[field]} onChange={(e) => update({ ...story, [field]: e.target.value } as Story)} className="field mt-4" /> : <p className="text-xs text-cream-600 mt-3">Not built yet — it fills in automatically once episodes are written.</p>}
            </details>
          ))}
        </div>

        <footer className="text-center text-xs text-cream-600 mt-10 pb-4">Endovel Story Factory · the master plan is the controlling authority</footer>
      </div>
    </main>
  );
}