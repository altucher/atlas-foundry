// IMAGES AND VISION THROUGH THE TAO-1 API (AI2 2026-10-12, founder: "use Chutes for the exploded pictures"). TAO-1's media path (Chutes: qwen-image-2512, z-image-turbo as the
// fast fallback) is reached through /v1/chat/completions: an image request answers with a markdown image link. The atlas server downloads the file and keeps its own copy.
// Vision (image QA, hotspot mapping) is a chat call with an image content part. Both use the same internal key and base URL as the text path (app/tao1-text.ts).
import { Agent, fetch as undiciFetch } from 'undici';

import { currentBuildId } from '@/app/cost-ledger';
import type { Tao1Connection } from '@/app/tao1-text';

const dispatcher = new Agent({ headersTimeout: 400_000, bodyTimeout: 400_000, connectTimeout: 30_000 });

export type Tao1ImageResult = { dataUrl: string; mime: string; bytes: number; ms: number; sourceUrl: string; usage: { prompt_tokens?: number; completion_tokens?: number } | null; width: number | null; height: number | null };

function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** one image through TAO-1's media path; the prompt is the finished picture prompt */
export async function tao1GenerateImage(conn: Tao1Connection, prompt: string): Promise<Tao1ImageResult> {
  const t0 = Date.now();
  const response = await undiciFetch(`${conn.baseUrl}/chat/completions`, {
    dispatcher, method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: conn.model, messages: [{ role: 'user', content: `Please generate this image for me. I want the picture itself, not a description and not a prompt for another tool.\n\n${prompt}` }], metadata: { session_id: `explode-${currentBuildId() ?? 'adhoc'}`, source: 'explode-anything-image' } }),
  });
  if (!response.ok) throw new Error(`TAO-1 image call failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const content = payload.choices?.[0]?.message?.content ?? '';
  const match = /!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/.exec(content) ?? /(https:\/\/[^\s)]+\.(?:png|jpe?g|webp))/i.exec(content) ?? /(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)/.exec(content);
  if (!match) throw new Error(`TAO-1 image call returned no image: ${content.slice(0, 200)}`);
  const sourceUrl = match[1];
  let buf: Buffer; let mime = 'image/png';
  if (sourceUrl.startsWith('data:')) {
    const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(sourceUrl)!; mime = m[1]; buf = Buffer.from(m[2], 'base64');
  } else {
    const file = await undiciFetch(sourceUrl, { dispatcher });
    if (!file.ok) throw new Error(`Image download failed (${file.status}).`);
    mime = (file.headers.get('content-type') ?? 'image/png').split(';')[0];
    buf = Buffer.from(await file.arrayBuffer());
  }
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error(`Unexpected image type ${mime}.`);
  const size = imageSize(buf);
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime, bytes: buf.length, ms: Date.now() - t0, sourceUrl: sourceUrl.startsWith('data:') ? 'inline' : sourceUrl, usage: payload.usage ?? null, width: size?.w ?? null, height: size?.h ?? null };
}

/** a vision call (image content part) returning the model's text; used for image QA and hotspot mapping */
export async function tao1VisionText(conn: Tao1Connection, system: string, userText: string, imageDataUrl: string, maxTokens = 4000, onlyModel?: string) {
  const t0 = Date.now();
  const response = await undiciFetch(`${conn.baseUrl}/chat/completions`, {
    dispatcher, method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: conn.model, ...(onlyModel ? { only_model: onlyModel } : {}), max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: imageDataUrl } }] }], metadata: { session_id: `explode-${currentBuildId() ?? 'adhoc'}`, source: 'explode-anything-vision' } }),
  });
  if (!response.ok) throw new Error(`TAO-1 vision call failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
  // a gateway-salvaged cut reply (finish_reason 'length') would parse as a short but valid list: never use it
  if (payload.choices?.[0]?.finish_reason === 'length') throw new Error('TAO-1 vision reply was cut short (finish_reason length).');
  return { text: payload.choices?.[0]?.message?.content ?? '', usage: payload.usage ?? null, ms: Date.now() - t0 };
}

// DIRECT CHUTE CALL (interim, founder 10-12): the same chutes the TAO-1 media harness uses (src/harnesses/media.mjs there: POST <chute>/generate {prompt}, the reply body is the
// image file, 502/503 = cold chute), called from the atlas server with CHUTES_API_KEY, with width/height for a landscape or portrait plate. qwen-image-2512 first, z-image-turbo
// as the fast fallback. A 4xx that rejects the size fields is retried once with the prompt alone.
const CHUTES_IMAGE = [
  { label: 'chutes/qwen-image-2512', url: 'https://vonkaiser-qwen-image-2512.chutes.ai/generate' },
  { label: 'chutes/z-image-turbo', url: 'https://vonkaiser-z-image-turbo.chutes.ai/generate' },
];

export type ChutesImageResult = Tao1ImageResult & { model: string };

export async function chutesGenerateImage(apiKey: string, prompt: string, orientation: 'landscape' | 'portrait'): Promise<ChutesImageResult> {
  const t0 = Date.now();
  const sized = orientation === 'portrait' ? { width: 1024, height: 1536 } : { width: 1536, height: 1024 };
  const errors: string[] = [];
  for (const chute of CHUTES_IMAGE) {
    // z-image-turbo refuses long prompts (400 above a few hundred characters): it gets the opening of the prompt
    const text = chute.label.includes('z-image') ? prompt.slice(0, 700) : prompt;
    for (const body of [{ prompt: text, ...sized }, { prompt: text }]) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        let response;
        try {
          response = await undiciFetch(chute.url, { dispatcher, method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } catch (error) { errors.push(`${chute.label}: ${error instanceof Error ? error.message : 'request failed'}`); break; }
        // 502/503, 429 (busy) and a 500 "No infrastructure available" (cold or full chute) are transient: wait and retry
        if ([429, 500, 502, 503].includes(response.status) && attempt < 3) {
          const peek = response.status === 500 ? (await response.text().catch(() => '')) : '';
          if (response.status !== 500 || /No infrastructure|unavailable|overloaded/i.test(peek)) { await new Promise((resolve) => setTimeout(resolve, 10_000 * (attempt + 1))); continue; }
          errors.push(`${chute.label}: HTTP 500 ${peek.replace(/\s+/g, ' ').slice(0, 120)}`); break;
        }
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
          errors.push(`${chute.label}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
          if (response.status === 402 || response.status === 401) throw new Error(`Chutes refused the request (${response.status}): ${errors.join('; ')}`);
          break;
        }
        const buf = Buffer.from(await response.arrayBuffer());
        const mime = (response.headers.get('content-type') ?? 'image/png').split(';')[0];
        if (buf.length < 1000 || !/^image\/(png|jpeg|webp)$/.test(mime)) { errors.push(`${chute.label}: empty or unexpected reply`); break; }
        const size = imageSize(buf);
        return { model: chute.label, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime, bytes: buf.length, ms: Date.now() - t0, sourceUrl: chute.url, usage: null, width: size?.w ?? null, height: size?.h ?? null };
      }
      if (errors.length && /HTTP (400|422)/.test(errors[errors.length - 1]) && 'width' in body) continue; // the chute rejected the size fields: try the prompt alone
      else break;
    }
  }
  throw new Error(`Chutes image generation failed: ${errors.join('; ').slice(0, 400)}`);
}


// OPENROUTER IMAGE (exploded view only, Master 10-12): one chat call with modalities image+text; the reply carries the picture as a data URL and OpenRouter's own usage.cost,
// which the usage record keeps as the real cost of the call. flash-image ($0.067, 14 s, 5 of 6 pass the relaxed QA) is attempt 1; flash-lite ($0.034, 6 s, 3 of 6) is the retry.
export async function openrouterGenerateImage(apiKey: string, model: string, prompt: string): Promise<Tao1ImageResult & { model: string; cost: number | null }> {
  const t0 = Date.now();
  const response = await undiciFetch('https://openrouter.ai/api/v1/chat/completions', {
    dispatcher, method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'explode-anything' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'], usage: { include: true } }),
  });
  if (!response.ok) throw new Error(`OpenRouter image call failed (${response.status}): ${(await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);
  const payload = await response.json() as { choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number } };
  const url = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]*)$/.exec(url);
  if (!m) throw new Error('OpenRouter image call returned no image.');
  const buf = Buffer.from(m[2], 'base64');
  const size = imageSize(buf);
  const cost = typeof payload.usage?.cost === 'number' ? payload.usage.cost : null;
  return { model, cost, dataUrl: url, mime: m[1], bytes: buf.length, ms: Date.now() - t0, sourceUrl: 'openrouter', usage: payload.usage ?? null, width: size?.w ?? null, height: size?.h ?? null };
}


// LORA EXPLODED VIEW (open-weight only): Qwen-Image-2512 + our exploded-view LoRA (+ Apache Lightning 8-step) on a RunPod serverless endpoint that scales to zero (handler jai_state/atlas_phase_a/lora/serve/handler_lora.py).
// POST /run, poll /status (a cold worker can take minutes: this is why the exploded view is rendered after the atlas is ready). Cost = billed execution seconds x ATLAS_LORA_USD_PER_SEC.
export async function loraGenerateImage(endpoint: string, apiKey: string, prompt: string): Promise<Tao1ImageResult & { model: string; cost: number | null }> {
  const t0 = Date.now();
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const submit = await undiciFetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}/run`, { dispatcher, method: 'POST', headers, body: JSON.stringify({ input: { prompt, width: 1280, height: 864 } }) });
  if (!submit.ok) throw new Error(`LoRA submit failed (${submit.status}).`);
  const job = await submit.json() as { id?: string };
  if (!job.id) throw new Error('LoRA submit returned no job id.');
  const deadline = t0 + (Number(process.env.ATLAS_LORA_TIMEOUT_MS) || 480_000); // a cold or capacity-starved endpoint must not hold the job: give up and ship assembled-only
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    if (Date.now() > deadline) {
      await undiciFetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}/cancel/${job.id}`, { dispatcher, method: 'POST', headers }).catch(() => undefined);
      throw new Error('LoRA job timed out.');
    }
    const poll = await undiciFetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpoint)}/status/${job.id}`, { dispatcher, headers });
    if (!poll.ok) continue;
    const status = await poll.json() as { status?: string; executionTime?: number; output?: { image_b64?: string }; error?: string };
    if (status.status === 'FAILED' || status.status === 'CANCELLED' || status.status === 'TIMED_OUT') throw new Error(`LoRA job ${status.status}.`);
    if (status.status !== 'COMPLETED') continue;
    const b64 = status.output?.image_b64;
    if (!b64) throw new Error('LoRA job returned no image.');
    const buf = Buffer.from(b64, 'base64');
    const size = imageSize(buf);
    const perSecond = Number(process.env.ATLAS_LORA_USD_PER_SEC) || 0.00076;
    return { model: 'tencent/LoRAImage-3.0-Instruct-Distil', cost: typeof status.executionTime === 'number' ? Math.round(status.executionTime / 1000 * perSecond * 1e6) / 1e6 : null, dataUrl: `data:image/png;base64,${b64}`, mime: 'image/png', bytes: buf.length, ms: Date.now() - t0, sourceUrl: 'runpod', usage: null, width: size?.w ?? null, height: size?.h ?? null };
  }
}

// TEXT REMOVAL (open-weight): Qwen-Image-Edit-2511 on Chutes redraws the same picture without any lettering, so a person never sees garbled pseudo-text (the atlas draws its own labels from the hotspot map)
export async function chutesRemoveText(apiKey: string, imageDataUrl: string): Promise<Tao1ImageResult & { model: string }> {
  const t0 = Date.now();
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]*)$/.exec(imageDataUrl);
  if (!m) throw new Error('Not an image data URL.');
  const size = imageSize(Buffer.from(m[2], 'base64'));
  const body: Record<string, unknown> = { prompt: 'Remove every piece of text, lettering, labels, numbers and captions from this image. Keep everything else exactly the same: the same shapes, colors, positions and white background.', image_b64s: [m[2]] };
  if (size) { body.width = Math.floor(size.w / 16) * 16; body.height = Math.floor(size.h / 16) * 16; }
  let lastError = 'no reply';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await undiciFetch('https://vonkaiser-qwen-image-edit-2511.chutes.ai/generate', { dispatcher, method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.ok) {
      const buf = Buffer.from(await response.arrayBuffer());
      const mime = (response.headers.get('content-type') ?? 'image/png').split(';')[0];
      if (buf.length > 1000 && /^image\/(png|jpeg|webp)$/.test(mime)) {
        const out = imageSize(buf);
        return { model: 'chutes/qwen-image-edit-2511', dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime, bytes: buf.length, ms: Date.now() - t0, sourceUrl: 'chutes-edit', usage: null, width: out?.w ?? null, height: out?.h ?? null };
      }
      lastError = 'empty reply';
    } else {
      lastError = `HTTP ${response.status}`;
      if (![429, 500, 502, 503].includes(response.status)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 8000 * (attempt + 1)));
  }
  throw new Error(`Text removal failed (${lastError}).`);
}
