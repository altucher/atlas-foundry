import { NextResponse } from 'next/server';

import type { AtlasPart, AtlasSource, FoundryAtlas } from '@/app/foundry-data';

export const runtime = 'nodejs';
export const maxDuration = 300;

const defaultResearchModel = 'gpt-6-astra';
const defaultImageModel = 'gpt-image-2.5-flare';
const requestWindows = new Map<string, number[]>();
const windowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 3;

type AiConnection = {
  apiKey: string;
  baseUrl: string;
  researchModel: string;
  imageModel: string;
};

function gatewayModel(model: string) {
  return model.includes('/') ? model : `openai/${model}`;
}

function directOpenAiModel(model: string) {
  return model.startsWith('openai/') ? model.slice('openai/'.length) : model;
}

function getAiConnection(request: Request): AiConnection | null {
  const configuredResearchModel = process.env.OPENAI_RESEARCH_MODEL ?? defaultResearchModel;
  const configuredImageModel = process.env.OPENAI_IMAGE_MODEL ?? defaultImageModel;
  const directApiKey = process.env.OPENAI_API_KEY;

  if (directApiKey) {
    return {
      apiKey: directApiKey,
      baseUrl: 'https://api.openai.com/v1',
      researchModel: directOpenAiModel(configuredResearchModel),
      imageModel: directOpenAiModel(configuredImageModel),
    };
  }

  const gatewayCredential = process.env.AI_GATEWAY_API_KEY
    ?? process.env.VERCEL_OIDC_TOKEN
    ?? request.headers.get('x-vercel-oidc-token');
  if (gatewayCredential) {
    return {
      apiKey: gatewayCredential,
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      researchModel: gatewayModel(configuredResearchModel),
      imageModel: gatewayModel(configuredImageModel),
    };
  }

  return null;
}

const atlasSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'subtitle', 'category', 'summary', 'accuracyNote', 'parts', 'sources', 'visualPrompt'],
  properties: {
    subject: { type: 'string' },
    subtitle: { type: 'string' },
    category: { type: 'string' },
    summary: { type: 'string' },
    accuracyNote: { type: 'string' },
    visualPrompt: { type: 'string' },
    sources: {
      type: 'array', minItems: 2, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'publisher', 'url'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' }, url: { type: 'string' },
        },
      },
    },
    parts: {
      type: 'array', minItems: 6, maxItems: 14,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'system', 'description', 'sourceId', 'color', 'sourceUrls', 'confidence'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, system: { type: 'string' },
          description: { type: 'string' }, sourceId: { type: 'string' }, color: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          confidence: { type: 'string', enum: ['high', 'medium', 'contextual'] },
        },
      },
    },
  },
} as const;

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('The research response did not contain an atlas.');
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeAtlas(raw: Omit<FoundryAtlas, 'mode'> & { visualPrompt: string }) {
  const sources: AtlasSource[] = raw.sources
    .map((source, index) => ({
      id: source.id || `source-${index + 1}`,
      title: source.title.slice(0, 140),
      publisher: source.publisher.slice(0, 80),
      url: safeUrl(source.url),
    }))
    .filter((source) => source.url);
  const knownUrls = new Set(sources.map((source) => source.url));
  const parts: AtlasPart[] = raw.parts.slice(0, 14).map((part, index) => ({
    ...part,
    id: part.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || `part-${index + 1}`,
    name: part.name.slice(0, 80),
    system: part.system.slice(0, 48),
    description: part.description.slice(0, 420),
    sourceId: part.sourceId.slice(0, 100),
    color: /^#[0-9a-fA-F]{6}$/.test(part.color) ? part.color : '#b9aa89',
    sourceUrls: part.sourceUrls.map(safeUrl).filter((url) => knownUrls.has(url)),
  }));
  return { ...raw, sources, parts };
}

function fallbackHotspots(parts: AtlasPart[]) {
  const columns = parts.length <= 8 ? 3 : 4;
  const rows = Math.ceil(parts.length / columns);
  return Object.fromEntries(parts.map((part, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, parts.length - row * columns);
    const x = itemsInRow === 1 ? 50 : 12 + (column * 76) / (itemsInRow - 1);
    const y = rows === 1 ? 50 : 16 + (row * 68) / (rows - 1);
    return [part.id, { x, y }];
  }));
}

async function generateImage(
  connection: AiConnection,
  subject: string,
  visualPrompt: string,
  mode: 'assembled' | 'exploded',
  parts: AtlasPart[],
) {
  const componentList = parts.map((part, index) => `${index + 1}. ${part.name} (${part.system})`).join('\n');
  const sharedDirection = `Photorealistic premium 3D product visualization of ${subject}. ${visualPrompt} Wide landscape, three-quarter view, deep charcoal and limestone museum studio, restrained graphite palette, realistic materials, precise soft key light and crisp rim lighting, high contrast with readable shadow detail. No people, no text, no labels, no arrows, no logos, no watermark, no workshop clutter. Educational conceptual visualization, not an engineering drawing or service guide.`;
  const modeDirection = mode === 'assembled'
    ? 'Show one complete, fully assembled object centered and intact. No cutaway, no exposed internals, and no floating or duplicated parts. Leave generous dark negative space around the silhouette.'
    : `Create the matching exploded-view companion in the same camera angle, scale, backdrop, lighting, and materials. Keep the recognizable main shell or enclosing structure central. Pull every documented major component below into a distinct, generously separated, non-overlapping visual cluster. Show each component once, preserve plausible relative scale, and fit the entire arrangement in frame. Do not invent tiny proprietary internals; represent uncertain items only as a credible major assembly.\n\nDocumented components:\n${componentList}`;
  const response = await fetch(`${connection.baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.imageModel,
      prompt: `${sharedDirection} ${modeDirection}`,
      size: '1536x1024', quality: 'high', output_format: 'webp',
    }),
  });
  if (!response.ok) throw new Error(`Image generation failed (${response.status}).`);
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const image = payload.data?.[0];
  if (image?.b64_json) return `data:image/webp;base64,${image.b64_json}`;
  if (image?.url) return image.url;
  throw new Error('Image generation returned no image.');
}

async function locateHotspots(connection: AiConnection, explodedImage: string, parts: AtlasPart[]) {
  const fallback = fallbackHotspots(parts);
  const hotspotSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['hotspots'],
    properties: {
      hotspots: {
        type: 'array',
        minItems: parts.length,
        maxItems: parts.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'x', 'y'],
          properties: {
            id: { type: 'string' },
            x: { type: 'number', minimum: 0, maximum: 100 },
            y: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
  } as const;
  const partList = parts.map((part) => `${part.id}: ${part.name}`).join('\n');
  const response = await fetch(`${connection.baseUrl}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.researchModel,
      instructions: 'Locate components in an exploded-view product image. Return the visual center of each requested component cluster as x/y percentages measured from the top-left corner. Use every exact id once. If several related pieces form one system, use the center of that cluster.',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: `Locate these components:\n${partList}` },
          { type: 'input_image', image_url: explodedImage, detail: 'high' },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'atlas_hotspots', strict: true, schema: hotspotSchema } },
    }),
  });
  if (!response.ok) throw new Error(`Hotspot mapping failed (${response.status}).`);
  const payload = (await response.json()) as Record<string, unknown>;
  const located = JSON.parse(extractOutputText(payload)) as { hotspots?: Array<{ id: string; x: number; y: number }> };
  const knownIds = new Set(parts.map((part) => part.id));
  for (const hotspot of located.hotspots ?? []) {
    if (!knownIds.has(hotspot.id) || !Number.isFinite(hotspot.x) || !Number.isFinite(hotspot.y)) continue;
    fallback[hotspot.id] = {
      x: Math.max(7, Math.min(93, hotspot.x)),
      y: Math.max(9, Math.min(88, hotspot.y)),
    };
  }
  return fallback;
}

export async function POST(request: Request) {
  const connection = getAiConnection(request);
  if (!connection) {
    return NextResponse.json(
      { code: 'NOT_CONFIGURED', error: 'Live atlas generation is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let prompt = '';
  try {
    const body = (await request.json()) as { prompt?: unknown };
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Send a JSON body with a prompt.' }, { status: 400 });
  }
  if (prompt.length < 2 || prompt.length > 160) {
    return NextResponse.json({ error: 'Prompt must be between 2 and 160 characters.' }, { status: 400 });
  }

  const clientId = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const recent = (requestWindows.get(clientId) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= maxRequestsPerWindow) {
    return NextResponse.json({ error: 'Atlas generation is limited to three requests every ten minutes. Please try again shortly.' }, { status: 429 });
  }
  recent.push(now);
  requestWindows.set(clientId, recent);

  const instructions = `You create careful educational component atlases. Research the requested subject on the public web, prioritizing first-party manuals, museums, universities, government sources, standards bodies, and strong technical references. Identify 6–14 meaningful, physically distinct parts or major systems that a general learner can understand. Never invent proprietary internals, exact geometry, hidden components, or identifiers. When documentation does not support a claim, mark it contextual. Do not provide dangerous disassembly instructions. Return concise plain English. Source URLs must be real HTTPS pages you consulted and every part should cite at least one of the returned source URLs when possible. The visualPrompt should describe the object's documented external appearance, materials, proportions, and a canonical three-quarter camera view suitable for a consistent photorealistic assembled/exploded image pair. State the limits of the atlas and distinguish a conceptual catalog from an engineering drawing, service manual, clinical tool, or exhaustive dataset.`;

  try {
    const researchResponse = await fetch(`${connection.baseUrl}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: connection.researchModel,
        instructions,
        input: `Build a component atlas for: ${prompt}`,
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        text: { format: { type: 'json_schema', name: 'component_atlas', strict: true, schema: atlasSchema } },
      }),
    });
    if (!researchResponse.ok) {
      const detail = await researchResponse.text();
      console.error('Research request failed', researchResponse.status, detail.slice(0, 800));
      return NextResponse.json({ error: `Research service failed (${researchResponse.status}).` }, { status: 502 });
    }
    const responsePayload = (await researchResponse.json()) as Record<string, unknown>;
    const rawAtlas = JSON.parse(extractOutputText(responsePayload)) as Omit<FoundryAtlas, 'mode'> & { visualPrompt: string };
    const normalized = normalizeAtlas(rawAtlas);
    const imageResults = await Promise.allSettled([
      generateImage(connection, normalized.subject, normalized.visualPrompt, 'assembled', normalized.parts),
      generateImage(connection, normalized.subject, normalized.visualPrompt, 'exploded', normalized.parts),
    ]);
    const image = imageResults[0].status === 'fulfilled' ? imageResults[0].value : undefined;
    const explodedImage = imageResults[1].status === 'fulfilled' ? imageResults[1].value : undefined;
    const imageWarnings = imageResults.flatMap((result, index) => result.status === 'rejected'
      ? [`${index === 0 ? 'Assembled' : 'Exploded'} image: ${result.reason instanceof Error ? result.reason.message : 'generation failed.'}`]
      : []);
    const imageWarning = imageWarnings.length ? imageWarnings.join(' ') : undefined;
    let hotspots = explodedImage ? fallbackHotspots(normalized.parts) : undefined;
    if (explodedImage) {
      try {
        hotspots = await locateHotspots(connection, explodedImage, normalized.parts);
      } catch (error) {
        console.warn('Using fallback hotspot layout', error);
      }
    }
    const atlas: FoundryAtlas = {
      subject: normalized.subject,
      subtitle: normalized.subtitle,
      category: normalized.category,
      summary: normalized.summary,
      accuracyNote: normalized.accuracyNote,
      parts: normalized.parts,
      sources: normalized.sources,
      image,
      imageAlt: `Photorealistic AI-generated assembled reference view of ${normalized.subject}`,
      explodedImage,
      explodedImageAlt: `Photorealistic AI-generated conceptual exploded view of ${normalized.subject}`,
      hotspots,
      mode: 'generated',
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json({
      atlas,
      imageWarning,
      researchModel: connection.researchModel,
      imageModel: connection.imageModel,
    });
  } catch (error) {
    console.error('Atlas generation failed', error);
    return NextResponse.json({ error: 'The atlas could not be generated. Please try a more specific subject.' }, { status: 500 });
  }
}
