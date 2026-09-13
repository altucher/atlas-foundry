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

async function generateImage(connection: AiConnection, subject: string, visualPrompt: string) {
  const response = await fetch(`${connection.baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.imageModel,
      prompt: `Technical catalog hero image of ${subject}. ${visualPrompt} Show one fully assembled object, centered, three-quarter view, limestone and graphite dark studio, precise museum product lighting, isolated background, no people, no labels, no text, no logos, no exploded parts. Educational visualization, not an engineering drawing.`,
      size: '1536x1024', quality: 'medium', output_format: 'webp',
    }),
  });
  if (!response.ok) throw new Error(`Image generation failed (${response.status}).`);
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const image = payload.data?.[0];
  if (image?.b64_json) return `data:image/webp;base64,${image.b64_json}`;
  if (image?.url) return image.url;
  throw new Error('Image generation returned no image.');
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

  const instructions = `You create careful educational component atlases. Research the requested subject on the public web, prioritizing first-party manuals, museums, universities, government sources, standards bodies, and strong technical references. Identify 6–14 meaningful, physically distinct parts or major systems that a general learner can understand. Never invent proprietary internals, exact geometry, hidden components, or identifiers. When documentation does not support a claim, mark it contextual. Do not provide dangerous disassembly instructions. Return concise plain English. Source URLs must be real HTTPS pages you consulted and every part should cite at least one of the returned source URLs when possible. The visualPrompt should describe the external appearance only. State the limits of the atlas and distinguish a conceptual catalog from an engineering drawing, service manual, clinical tool, or exhaustive dataset.`;

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
    let image: string | undefined;
    let imageWarning: string | undefined;
    try {
      image = await generateImage(connection, normalized.subject, normalized.visualPrompt);
    } catch (error) {
      imageWarning = error instanceof Error ? error.message : 'The assembled image could not be generated.';
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
      imageAlt: `AI-generated assembled reference view of ${normalized.subject}`,
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
