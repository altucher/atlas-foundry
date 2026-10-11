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
