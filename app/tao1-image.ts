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
export async function tao1VisionText(conn: Tao1Connection, system: string, userText: string, imageDataUrl: string, maxTokens = 4000) {
  const t0 = Date.now();
  const response = await undiciFetch(`${conn.baseUrl}/chat/completions`, {
    dispatcher, method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: conn.model, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: imageDataUrl } }] }], metadata: { session_id: `explode-${currentBuildId() ?? 'adhoc'}`, source: 'explode-anything-vision' } }),
  });
  if (!response.ok) throw new Error(`TAO-1 vision call failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
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
    for (const body of [{ prompt, ...sized }, { prompt }]) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response;
        try {
          response = await undiciFetch(chute.url, { dispatcher, method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        } catch (error) { errors.push(`${chute.label}: ${error instanceof Error ? error.message : 'request failed'}`); break; }
        if ((response.status === 502 || response.status === 503) && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 8000)); continue; }
        if (!response.ok) {
          errors.push(`${chute.label}: HTTP ${response.status}`);
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
