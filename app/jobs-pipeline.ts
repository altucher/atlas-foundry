import { POST as generateAtlas } from '@/app/api/generate-atlas/route';

export type StreamResult = { status: number; payload: Record<string, unknown>; buildId?: string };

export async function callPipeline(origin: string, callerAddress: string, subject: string, phase: 'draft' | 'enrich' | 'reexplode', who: string, onProgress: (stage: string, message: string) => void): Promise<StreamResult> {
  const response = await generateAtlas(new Request(`${origin}/api/generate-atlas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson', 'x-real-ip': callerAddress, 'x-atlas-jobs-key': process.env.ATLAS_JOBS_KEY ?? '', 'x-atlas-who': who },
    body: JSON.stringify({ prompt: subject, phase }),
  }));
  if (!response.body) return { status: response.status, payload: await response.json().catch(() => ({})) as Record<string, unknown> };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: StreamResult | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; stage?: string; message?: string; status?: number; payload?: Record<string, unknown>; buildId?: string };
        if (entry.type === 'progress' && entry.stage && entry.stage !== 'source') onProgress(entry.stage, entry.message ?? '');
        if (entry.type === 'result') result = { status: entry.status ?? 500, payload: entry.payload ?? {}, buildId: entry.buildId };
      } catch { /* ignore a partial line */ }
    }
  }
  return result ?? { status: 502, payload: { error: 'The build ended without a result.' } };
}

/** the LoRA exploded-view endpoint scales to zero and a cold worker takes minutes: ask it for a tiny throwaway image at job start so the worker is up by the time the draft is ready */
export function warmLoraEndpoint() {
  const endpoint = process.env.ATLAS_LORA_ENDPOINT?.trim();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (process.env.ATLAS_EXPLODED_PROVIDER?.trim().toLowerCase() !== 'lora' || !endpoint || !apiKey) return;
  void fetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}/run`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { prompt: 'Axonometric exploded technical diagram of a small cube, white background, no text.', width: 512, height: 512, seed: 1 } }) }).catch(() => undefined);
}


/** the LoRA exploded view runs as its own follow-up function after the job is done (set ATLAS_LORA_ASYNC=0 to render it inside the job instead) */
export function loraAsyncOn() {
  return process.env.ATLAS_EXPLODED_PROVIDER?.trim().toLowerCase() === 'lora' && Boolean(process.env.ATLAS_LORA_ENDPOINT?.trim()) && Boolean(process.env.RUNPOD_API_KEY?.trim()) && process.env.ATLAS_LORA_ASYNC !== '0';
}
