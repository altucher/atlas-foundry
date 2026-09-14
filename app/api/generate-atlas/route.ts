import { NextResponse } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';

import { cacheKeyForPrompt, loadCachedAtlas, saveAtlasToGallery } from '@/app/atlas-store';
import { CURRENT_INTELLIGENCE_VERSION, type AtlasHotspot, type AtlasPart, type AtlasSource, type FoundryAtlas } from '@/app/foundry-data';

export const runtime = 'nodejs';
// Deep generic architectures can spend several minutes in source-backed research
// before the matched image and hotspot passes begin. Vercel Pro/Enterprise Fluid
// compute permits up to 800 seconds; deployments need a plan that accepts it.
export const maxDuration = 800;

const defaultResearchModel = 'gpt-6-astra';
const defaultImageModel = 'gpt-image-2.5-flare';
const requestWindows = new Map<string, number[]>();
const windowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 3;
const supplierRoles = ['manufacturer', 'assembler', 'designer', 'ip-licensor', 'software-provider', 'material-supplier', 'integrator', 'other'] as const;
const aiDispatcher = new Agent({
  headersTimeout: 780_000,
  bodyTimeout: 780_000,
  connectTimeout: 30_000,
});

type ProgressStage = 'cache' | 'research' | 'source' | 'inventory' | 'vendor' | 'render' | 'mapping' | 'save' | 'done';
type ProgressReporter = (entry: { stage: ProgressStage; message: string }) => void;

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
  required: ['subject', 'subtitle', 'category', 'summary', 'accuracyNote', 'parts', 'sources', 'visualPrompt', 'imageOrientation'],
  properties: {
    subject: { type: 'string' },
    subtitle: { type: 'string' },
    category: { type: 'string' },
    summary: { type: 'string' },
    accuracyNote: { type: 'string' },
    visualPrompt: { type: 'string' },
    imageOrientation: { type: 'string', enum: ['landscape', 'portrait'] },
    sources: {
      type: 'array', minItems: 2, maxItems: 40,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'publisher', 'url'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' }, url: { type: 'string' },
        },
      },
    },
    parts: {
      type: 'array', minItems: 12, maxItems: 60,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'system', 'description', 'sourceId', 'color', 'sourceUrls', 'confidence', 'suppliers', 'connections'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, system: { type: 'string' },
          description: { type: 'string' }, sourceId: { type: 'string' }, color: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          confidence: { type: 'string', enum: ['high', 'medium', 'contextual'] },
          connections: {
            type: 'array',
            minItems: 0,
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['toPartId', 'relationship', 'description'],
              properties: {
                toPartId: { type: 'string' },
                relationship: { type: 'string', enum: ['power', 'data', 'thermal', 'fluid', 'mechanical', 'structural', 'control', 'other'] },
                description: { type: 'string' },
              },
            },
          },
          suppliers: {
            type: 'array',
            minItems: 0,
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['company', 'role', 'isPublicCompany', 'ticker', 'exchange', 'yahooSymbol', 'evidenceUrl', 'relationshipStatus', 'note'],
              properties: {
                company: { type: 'string' },
                role: { type: 'string', enum: supplierRoles },
                isPublicCompany: { type: 'boolean' },
                ticker: { type: ['string', 'null'] },
                exchange: { type: ['string', 'null'] },
                yahooSymbol: { type: ['string', 'null'] },
                evidenceUrl: { type: 'string' },
                relationshipStatus: { type: 'string', enum: ['confirmed', 'reported', 'rumored'] },
                note: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

const supplierResearchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sources', 'relationships'],
  properties: {
    sources: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'publisher', 'url'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' }, url: { type: 'string' },
        },
      },
    },
    relationships: {
      type: 'array', minItems: 0, maxItems: 160,
      items: {
        type: 'object', additionalProperties: false,
        required: ['partId', 'company', 'role', 'isPublicCompany', 'ticker', 'exchange', 'yahooSymbol', 'evidenceUrl', 'relationshipStatus', 'note'],
        properties: {
          partId: { type: 'string' },
          company: { type: 'string' },
          role: { type: 'string', enum: supplierRoles },
          isPublicCompany: { type: 'boolean' },
          ticker: { type: ['string', 'null'] },
          exchange: { type: ['string', 'null'] },
          yahooSymbol: { type: ['string', 'null'] },
          evidenceUrl: { type: 'string' },
          relationshipStatus: { type: 'string', enum: ['confirmed', 'reported', 'rumored'] },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

type SupplierResearchResult = {
  sources: AtlasSource[];
  relationships: Array<{
    partId: string;
    company: string;
    role: (typeof supplierRoles)[number];
    isPublicCompany: boolean;
    ticker: string | null;
    exchange: string | null;
    yahooSymbol: string | null;
    evidenceUrl: string;
    relationshipStatus: 'confirmed' | 'reported' | 'rumored';
    note: string;
  }>;
};

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
  const parts: AtlasPart[] = raw.parts.slice(0, 60).map((part, index) => {
    const supplierMap = new Map<string, NonNullable<AtlasPart['suppliers']>[number]>();
    for (const supplier of part.suppliers ?? []) {
      const evidenceUrl = safeUrl(supplier.evidenceUrl);
      const isPublicCompany = supplier.isPublicCompany === true;
      const yahooSymbol = supplier.yahooSymbol?.trim().slice(0, 24) || null;
      const ticker = supplier.ticker?.trim().slice(0, 24) || null;
      const exchange = supplier.exchange?.trim().slice(0, 40) || null;
      if (!evidenceUrl
        || !knownUrls.has(evidenceUrl)
        || !supplier.company.trim()
        || (isPublicCompany && (!yahooSymbol || !ticker || !exchange || !/^[A-Za-z0-9.^=-]{1,24}$/.test(yahooSymbol)))
        || !['confirmed', 'reported', 'rumored'].includes(supplier.relationshipStatus)) continue;
      const normalizedSupplier: NonNullable<AtlasPart['suppliers']>[number] = {
        company: supplier.company.trim().slice(0, 100),
        role: supplierRoles.includes(supplier.role ?? 'other') ? (supplier.role ?? 'other') : 'other',
        isPublicCompany,
        ticker: isPublicCompany ? ticker : null,
        exchange: isPublicCompany ? exchange : null,
        yahooSymbol: isPublicCompany ? yahooSymbol : null,
        evidenceUrl,
        financeUrl: isPublicCompany && yahooSymbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol)}/` : null,
        relationshipStatus: supplier.relationshipStatus,
        note: supplier.note.trim().slice(0, 420),
      };
      const key = `${normalizedSupplier.company}|${normalizedSupplier.relationshipStatus}|${normalizedSupplier.note}`.toLowerCase();
      if (!supplierMap.has(key)) supplierMap.set(key, normalizedSupplier);
    }
    const suppliers = [...supplierMap.values()].slice(0, 10);
    const sourceUrls = part.sourceUrls.map(safeUrl).filter((url) => knownUrls.has(url));
    for (const supplier of suppliers) {
      if (!sourceUrls.includes(supplier.evidenceUrl)) sourceUrls.push(supplier.evidenceUrl);
    }
    return {
      ...part,
      id: part.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || `part-${index + 1}`,
      name: part.name.slice(0, 80),
      system: part.system.slice(0, 48),
      description: part.description.slice(0, 420),
      sourceId: part.sourceId.slice(0, 100),
      color: /^#[0-9a-fA-F]{6}$/.test(part.color) ? part.color : '#b9aa89',
      sourceUrls: sourceUrls.slice(0, 10),
      suppliers: suppliers.length ? suppliers : undefined,
      connections: part.connections,
    };
  });
  const knownPartIds = new Set(parts.map((part) => part.id));
  const connectedParts = parts.map((part) => ({
    ...part,
    connections: (part.connections ?? [])
      .map((connection) => ({
        toPartId: connection.toPartId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80),
        relationship: connection.relationship,
        description: connection.description.trim().slice(0, 220),
      }))
      .filter((connection) => knownPartIds.has(connection.toPartId) && connection.toPartId !== part.id)
      .slice(0, 10),
  }));
  return {
    ...raw,
    imageOrientation: raw.imageOrientation === 'portrait' ? 'portrait' as const : 'landscape' as const,
    sources,
    parts: connectedParts,
  };
}

function fallbackHotspots(parts: AtlasPart[]) {
  const columns = parts.length <= 8 ? 3 : parts.length <= 24 ? 4 : parts.length <= 40 ? 5 : 6;
  const rows = Math.ceil(parts.length / columns);
  return Object.fromEntries(parts.map((part, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, parts.length - row * columns);
    const x = itemsInRow === 1 ? 50 : 12 + (column * 76) / (itemsInRow - 1);
    const y = rows === 1 ? 50 : 16 + (row * 68) / (rows - 1);
    return [part.id, {
      x,
      y,
      width: Math.min(20, 68 / columns),
      height: Math.min(18, 58 / rows),
    }];
  })) as Record<string, AtlasHotspot>;
}

function responseFailure(payload: Record<string, unknown>) {
  const error = payload.error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  const incomplete = payload.incomplete_details;
  if (incomplete && typeof incomplete === 'object' && 'reason' in incomplete && typeof incomplete.reason === 'string') return incomplete.reason;
  return `Research ended with status ${String(payload.status ?? 'unknown')}.`;
}

async function generateResearchInBackground(
  connection: AiConnection,
  body: Record<string, unknown>,
  report: ProgressReporter,
  progress: { stage: ProgressStage; message: string } = { stage: 'research', message: 'Researching the architecture and component evidence' },
) {
  const headers = { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' };
  const created = await undiciFetch(`${connection.baseUrl}/responses`, {
    dispatcher: aiDispatcher,
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, background: true, store: true }),
  });
  if (!created.ok) {
    const detail = await created.text();
    throw new Error(`Research service failed (${created.status}): ${detail.slice(0, 500)}`);
  }

  let payload = (await created.json()) as Record<string, unknown>;
  const responseId = typeof payload.id === 'string' ? payload.id : '';
  if (!responseId) throw new Error('Background research returned no response id.');
  const startedAt = Date.now();
  let lastProgressAt = 0;

  while (payload.status === 'queued' || payload.status === 'in_progress') {
    const elapsed = Date.now() - startedAt;
    if (elapsed > 500_000) throw new Error('Background research exceeded its eight-minute completion budget.');
    if (elapsed - lastProgressAt >= 25_000) {
      report({ stage: progress.stage, message: `${progress.message}… ${Math.max(1, Math.round(elapsed / 1000))} seconds elapsed.` });
      lastProgressAt = elapsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const polled = await undiciFetch(`${connection.baseUrl}/responses/${encodeURIComponent(responseId)}`, {
      dispatcher: aiDispatcher,
      method: 'GET',
      headers,
    });
    if (!polled.ok) {
      const detail = await polled.text();
      throw new Error(`Research polling failed (${polled.status}): ${detail.slice(0, 500)}`);
    }
    payload = (await polled.json()) as Record<string, unknown>;
  }

  if (payload.status !== 'completed') throw new Error(responseFailure(payload));
  return payload;
}

async function researchSupplierBatch(
  connection: AiConnection,
  atlas: ReturnType<typeof normalizeAtlas>,
  parts: AtlasPart[],
  batchIndex: number,
  batchCount: number,
  report: ProgressReporter,
) {
  const partList = parts.map((part) => `${part.id} | ${part.name} | ${part.system}`).join('\n');
  const existingSources = atlas.sources.map((source) => `${source.publisher}: ${source.url}`).join('\n');
  const instructions = `You are a forensic component-supply-chain researcher. Investigate potential vendors for EVERY component id supplied. Search component by component rather than stopping after famous headline suppliers. Return every defensible current, former, alternative, generation-specific, factory-specific, regional, or credible published rumored relationship supported by a returned source. Several companies may be returned for one component.

Distinguish the vendor's role precisely: manufacturer, assembler, designer, IP licensor, software provider, material supplier, integrator, or other. Treat cell makers and battery-pack assemblers as different roles; likewise distinguish a display-panel maker from the finished display-module assembler, a semiconductor foundry from a chip designer or IP licensor, and a component maker from the product's contract assembler. Include relevant licensed architecture, protocol, codec, semiconductor, software, or other embedded IP only when a source establishes it.

For a specific named product, only connect a vendor to a component when the evidence explicitly ties it to that product, product family, teardown, generation, model year, trim, market, factory, or period. A general corporate supplier list confirms that a company supplies the brand, but by itself does not prove which component it supplies. Use it as corroboration, not as an invented component mapping. For a generic category, a relationship may show that the vendor makes or sells that exact component class; the note must call it a representative market offering and not evidence of deployment in one facility.

Set confirmed only for first-party statements, regulatory records, procurement records, direct component markings/teardowns, or customer/supplier material that establishes the relationship. Set reported for a credible established technical, industry, or financial publication. Set rumored only when a real returned publication explicitly makes the claim. Do not convert repetition, resale listings, repair-shop marketing, or visual resemblance into evidence.

Each note must state the role, exact product/version/time scope, whether the relationship is current, historical, alternative, or uncertain, and what the cited source actually establishes. Every evidenceUrl must exactly match one URL in sources. Use real HTTPS URLs consulted in this pass. Set current public-company ticker, exchange, and exact Yahoo symbol; use null for all three private-company fields. Return no relationship when evidence is inadequate.`;
  report({ stage: 'vendor', message: `Supplier evidence pass ${batchIndex + 1}/${batchCount} · checking ${parts.length} components individually…` });
  const payload = await generateResearchInBackground(connection, {
    model: connection.researchModel,
    instructions,
    input: `Subject: ${atlas.subject}\nCategory: ${atlas.category}\nAccuracy boundary: ${atlas.accuracyNote}\n\nComponent ids:\n${partList}\n\nExisting architecture sources (use only when they directly support a relationship):\n${existingSources}`,
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    text: { format: { type: 'json_schema', name: 'supplier_evidence', strict: true, schema: supplierResearchSchema } },
  }, report, { stage: 'vendor', message: `Supplier evidence pass ${batchIndex + 1}/${batchCount} is still searching` });
  return JSON.parse(extractOutputText(payload)) as SupplierResearchResult;
}

async function enrichSuppliers(
  connection: AiConnection,
  atlas: ReturnType<typeof normalizeAtlas>,
  report: ProgressReporter,
) {
  const batchSize = 20;
  const batches = Array.from({ length: Math.ceil(atlas.parts.length / batchSize) }, (_, index) => atlas.parts.slice(index * batchSize, (index + 1) * batchSize));
  const settled = await Promise.allSettled(batches.map((parts, index) => researchSupplierBatch(connection, atlas, parts, index, batches.length, report)));
  const successful = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failedCount = settled.length - successful.length;
  for (const result of settled) {
    if (result.status === 'rejected') console.warn('Supplier evidence batch failed', result.reason);
  }
  if (failedCount) report({ stage: 'vendor', message: `${failedCount} of ${settled.length} supplier evidence ${failedCount === 1 ? 'pass was' : 'passes were'} unavailable; preserving all verified results from the completed passes.` });
  if (!successful.length) {
    report({ stage: 'vendor', message: 'No additional defensible supplier mappings were returned; retaining any relationships found in the architecture pass.' });
    return atlas;
  }

  const sourceByUrl = new Map(atlas.sources.map((source) => [source.url, source]));
  for (const result of successful) {
    for (const source of result.sources) {
      const url = safeUrl(source.url);
      if (!url || sourceByUrl.has(url)) continue;
      const normalizedSource = { ...source, url };
      sourceByUrl.set(url, normalizedSource);
      report({ stage: 'source', message: `Supplier source · ${source.publisher} — ${source.title}` });
    }
  }
  const sources = [...sourceByUrl.values()].map((source, index) => ({ ...source, id: `source-${index + 1}` }));
  const relationships = successful.flatMap((result) => result.relationships);
  const enriched = normalizeAtlas({
    ...atlas,
    sources,
    parts: atlas.parts.map((part) => ({
      ...part,
      suppliers: [
        ...(part.suppliers ?? []),
        ...relationships.filter((relationship) => relationship.partId === part.id).map((relationship) => ({ ...relationship, financeUrl: null })),
      ],
    })),
  });
  const relationshipCount = enriched.parts.reduce((count, part) => count + (part.suppliers?.length ?? 0), 0);
  const companyCount = new Set(enriched.parts.flatMap((part) => (part.suppliers ?? []).map((supplier) => supplier.company))).size;
  report({ stage: 'vendor', message: `Mapped ${relationshipCount} sourced component relationships across ${companyCount} potential vendors, including historical and variant-specific records.` });
  return enriched;
}

async function generateImage(
  connection: AiConnection,
  subject: string,
  visualPrompt: string,
  mode: 'assembled' | 'exploded',
  parts: AtlasPart[],
  imageOrientation: FoundryAtlas['imageOrientation'],
) {
  const componentList = parts.map((part, index) => `${index + 1}. ${part.name} (${part.system})`).join('\n');
  const formatDirection = imageOrientation === 'portrait'
    ? 'Tall portrait technical plate, with the complete vertical object and every separated assembly comfortably inside the frame.'
    : 'Wide landscape technical plate, with the complete object and every separated assembly comfortably inside the frame.';
  const sharedDirection = `Photorealistic premium 3D product visualization of ${subject}. ${visualPrompt} ${formatDirection} Canonical three-quarter view, deep charcoal and limestone museum studio, restrained graphite palette, realistic materials, precise soft key light and crisp rim lighting, high contrast with readable shadow detail. No people, no text, no labels, no arrows, no logos, no watermark, no workshop clutter. Educational conceptual visualization, not an engineering drawing or service guide.`;
  const modeDirection = mode === 'assembled'
    ? 'Show one complete, fully assembled object centered and intact. No cutaway, no exposed internals, and no floating or duplicated parts. Leave generous dark negative space around the silhouette.'
    : `Create the matching exhaustive exploded-view companion in the same camera angle, scale, backdrop, lighting, and materials. Keep the recognizable main shell or enclosing structure central. Pull every documented component below into a distinct, generously separated, non-overlapping visual cluster. Preserve meaningful nested assemblies and repeated parts such as engine clusters, landing legs, wheels, or fairing halves. For infrastructure and generic systems, arrange the clusters so the operating topology remains readable from inputs and utilities through distribution, equipment, data paths, cooling, controls, safety systems, and outputs. Show every listed component once, preserve plausible relative scale, and fit the entire arrangement in frame. Do not invent proprietary internals; represent uncertain items only at the assembly level supported by public evidence.\n\nDocumented components:\n${componentList}`;
  const response = await undiciFetch(`${connection.baseUrl}/images/generations`, {
    dispatcher: aiDispatcher,
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.imageModel,
      prompt: `${sharedDirection} ${modeDirection}`,
      size: imageOrientation === 'portrait' ? '1024x1536' : '1536x1024', quality: 'high', output_format: 'webp',
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
          required: ['id', 'x', 'y', 'width', 'height'],
          properties: {
            id: { type: 'string' },
            x: { type: 'number', minimum: 0, maximum: 100 },
            y: { type: 'number', minimum: 0, maximum: 100 },
            width: { type: 'number', minimum: 1, maximum: 100 },
            height: { type: 'number', minimum: 1, maximum: 100 },
          },
        },
      },
    },
  } as const;
  const partList = parts.map((part) => `${part.id}: ${part.name}`).join('\n');
  const response = await undiciFetch(`${connection.baseUrl}/responses`, {
    dispatcher: aiDispatcher,
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.researchModel,
      instructions: 'Locate components in an exploded-view product image. Return a tight clickable bounding rectangle for each requested component cluster. Express its center as x/y percentages and its size as width/height percentages of the full image, measured from the top-left corner. Use every exact id once. If several adjacent pieces form one system, enclose that cluster. Do not include unrelated neighboring parts.',
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
  const located = JSON.parse(extractOutputText(payload)) as { hotspots?: Array<AtlasHotspot & { id: string }> };
  const knownIds = new Set(parts.map((part) => part.id));
  for (const hotspot of located.hotspots ?? []) {
    if (!knownIds.has(hotspot.id) || !Number.isFinite(hotspot.x) || !Number.isFinite(hotspot.y) || !Number.isFinite(hotspot.width) || !Number.isFinite(hotspot.height)) continue;
    const width = Math.max(6, Math.min(38, hotspot.width ?? 10));
    const height = Math.max(6, Math.min(32, hotspot.height ?? 10));
    fallback[hotspot.id] = {
      x: Math.max(width / 2 + 1, Math.min(99 - width / 2, hotspot.x)),
      y: Math.max(height / 2 + 1, Math.min(96 - height / 2, hotspot.y)),
      width,
      height,
    };
  }
  return fallback;
}

export async function POST(request: Request) {
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

  const cacheOrigin = process.env.ATLAS_CACHE_ORIGIN?.trim();
  if (cacheOrigin) {
    try {
      const target = new URL('/api/generate-atlas', cacheOrigin);
      if (target.origin !== new URL(request.url).origin) {
        const response = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: request.headers.get('accept') ?? 'application/json',
          },
          body: JSON.stringify({ prompt }),
          cache: 'no-store',
        });
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
            'Cache-Control': response.headers.get('Cache-Control') ?? 'no-store',
          },
        });
      }
    } catch (error) {
      console.warn('Shared generation proxy unavailable; trying this deployment', error);
    }
  }

  const run = async (report: ProgressReporter): Promise<Response> => {
  report({ stage: 'cache', message: 'Checking the shared gallery for a finished atlas…' });
  const cachedAtlas = await loadCachedAtlas(cacheKeyForPrompt(prompt));
  if (cachedAtlas?.intelligenceVersion === CURRENT_INTELLIGENCE_VERSION) {
    report({ stage: 'done', message: `Found ${cachedAtlas.subject} in the shared gallery.` });
    return NextResponse.json({ atlas: cachedAtlas, cached: true });
  }
  if (cachedAtlas) report({ stage: 'cache', message: 'The saved atlas predates component-by-component supplier intelligence; rebuilding it once with the current research model…' });

  const connection = getAiConnection(request);
  if (!connection) {
    return NextResponse.json(
      { code: 'NOT_CONFIGURED', error: 'Live atlas generation is not configured on this deployment.' },
      { status: 503 },
    );
  }

  const clientId = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const recent = (requestWindows.get(clientId) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= maxRequestsPerWindow) {
    return NextResponse.json({ error: 'Atlas generation is limited to three requests every ten minutes. Please try again shortly.' }, { status: 429 });
  }
  recent.push(now);
  requestWindows.set(clientId, recent);

  const instructions = `You create careful, unusually detailed educational component atlases. Research the requested subject on the public web, prioritizing first-party manuals and product pages, museums, universities, government sources, standards bodies, regulatory filings, SEC or exchange filings, and strong technical references.

First decide whether the subject is a specific named product or a generic product/category made in many configurations. For a generic category, build a clearly labeled vendor-neutral reference architecture: show the most detailed plausible set of layers and alternative components supported by current public sources, but never imply that every listed component or vendor appears in one real installation. For infrastructure categories, follow the complete operating chain across facility, structure, utility inputs, distribution, safety, thermal systems, compute/control equipment, internal subassemblies, interfaces, networking, monitoring, and outputs. For example, a data-center atlas should be able to reach from the building, utility feed, generators, switchgear, UPS, busway/PDU, chillers or liquid-cooling loops and CDUs through pods, racks, servers, motherboards, CPUs, GPUs/accelerators, memory, storage, NICs/DPUs, leaf/spine switches, optical transceivers, fiber, DCI, controls, fire suppression, and physical security when supported—not stop at racks and servers.

Build the fullest useful component inventory that public evidence supports, within 12–60 physically or operationally distinct records. Use 12–24 parts for simple objects and 36–60 for complex engineered products, infrastructure, vehicles, rockets, aircraft, or machines. For a complex subject, do not stop at exterior sections: include documented second-, third-, and readable fourth-level assemblies such as structures, tanks, domes, conduits, valves, pumps, motors, actuators, bearings, propulsion units, engine clusters, control hardware, avionics, interfaces, thermal hardware, recovery hardware, protective enclosures, and other identifiable micro-components when the sources support them. Repeated assemblies may be one clearly named record with the documented quantity. Avoid filler, synonyms, duplicated records, generic fasteners, and details too small to identify even within a filtered exploded plate.

Never invent proprietary internals, exact geometry, hidden components, identifiers, suppliers, or stock listings. When documentation supports the existence of an assembly but not its precise construction, include it only at the supported assembly level and mark confidence contextual. Do not provide dangerous disassembly instructions. Return concise plain English. Source URLs must be real HTTPS pages you consulted and every part should cite at least one returned source URL when possible.

For an engineered product, suppliers is a list because one component may have multiple suppliers across variants, factories, generations, model years, contracts, or reports. Include both public and private suppliers when evidence supports the relationship. Distinguish each role as manufacturer, assembler, designer, IP licensor, software provider, material supplier, integrator, or other; do not collapse a cell maker into a battery-pack assembler, a chip designer into its foundry, or an IP licensor into the component manufacturer. For a named product, a supplier record means evidence connects that vendor to that product. For a generic category, a supplier record instead means evidence shows that the vendor makes or sells that exact component class; make the note say it is a representative vendor offering and not proof of deployment in any one facility. Include multiple credible alternative vendors per component when sources support them, rather than selecting one arbitrary company. When vendors differ by generation, year, trim, market, factory, or revision, include each separately and make that distinction explicit in note. Set one evidence status per relationship:
- confirmed: first-party, regulatory filing, customer, or supplier evidence directly confirms the component relationship;
- reported: a credible established technical or financial publication reports it, but the companies do not directly confirm it;
- rumored: a published rumor, analyst claim, or teardown inference alleges it without confirmation.
Rumors are allowed only when a real returned source publishes the claim. Never turn absence of evidence, visual resemblance, internet repetition, or your own inference into a rumor. The note must briefly state what product generation, version, period, region, plant, trim, generic-market role, or uncertainty the claim applies to. Do not treat the product's brand owner as a component supplier unless it actually manufactures that named component. Each evidenceUrl must exactly match one URL in sources that supports the component-supplier relationship, and part.sourceUrls must include it. Set isPublicCompany accurately. For a public company, ticker is its current exchange ticker and yahooSymbol is the exact symbol Yahoo Finance uses, including market suffixes such as .T, .DE, or .KS. For a private company, set ticker, exchange, and yahooSymbol to null.

This first pass should capture readily established supplier relationships but spend most of its search budget on the complete component architecture; a dedicated component-by-component vendor and IP pass follows.

Use connections to explain architecture. For each part, list up to ten directly connected returned part ids and classify each relationship as power, data, thermal, fluid, mechanical, structural, control, or other. The description must state what crosses the interface and in which direction when meaningful—for example electrical power, coolant, air, optical data, packets, torque, exhaust, or control signals. Use exact ids from the same parts array, never external or invented ids. Prefer a connected system graph over isolated component cards, but do not duplicate reciprocal edges unless each direction teaches something different.

Set imageOrientation to portrait for strongly vertical subjects such as launch vehicles, towers, standing anatomy, or long upright tools; otherwise use landscape. The visualPrompt should describe the object's documented external appearance, materials, proportions, and a canonical three-quarter camera view suitable for a consistent photorealistic assembled/exploded image pair. State the limits of the atlas and distinguish a conceptual catalog from an engineering drawing, service manual, clinical tool, literally exhaustive parts database, or investment recommendation.`;

  try {
    report({ stage: 'research', message: `Searching authoritative public sources for ${prompt}…` });
    const responsePayload = await generateResearchInBackground(connection, {
        model: connection.researchModel,
        instructions,
        input: `Build a component atlas for: ${prompt}`,
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        text: { format: { type: 'json_schema', name: 'component_atlas', strict: true, schema: atlasSchema } },
    }, report);
    const rawAtlas = JSON.parse(extractOutputText(responsePayload)) as Omit<FoundryAtlas, 'mode'> & { visualPrompt: string };
    const normalized = normalizeAtlas(rawAtlas);
    report({ stage: 'inventory', message: `Mapped ${normalized.parts.length} documented components across ${new Set(normalized.parts.map((part) => part.system)).size} systems.` });
    for (const source of normalized.sources) {
      report({ stage: 'source', message: `Source · ${source.publisher} — ${source.title}` });
    }
    report({ stage: 'render', message: 'Rendering a matched photorealistic assembled and exploded image pair…' });
    const [enriched, imageResults] = await Promise.all([
      enrichSuppliers(connection, normalized, report).catch((error) => {
        console.warn('Dedicated supplier evidence pass failed', error);
        report({ stage: 'vendor', message: 'The dedicated supplier pass was incomplete; retaining relationships established by the architecture research.' });
        return normalized;
      }),
      Promise.allSettled([
        generateImage(connection, normalized.subject, normalized.visualPrompt, 'assembled', normalized.parts, normalized.imageOrientation)
          .then((value) => { report({ stage: 'render', message: 'Assembled studio render complete.' }); return value; }),
        generateImage(connection, normalized.subject, normalized.visualPrompt, 'exploded', normalized.parts, normalized.imageOrientation)
          .then((value) => { report({ stage: 'render', message: 'Exploded component render complete.' }); return value; }),
      ]),
    ]);
    const image = imageResults[0].status === 'fulfilled' ? imageResults[0].value : undefined;
    const explodedImage = imageResults[1].status === 'fulfilled' ? imageResults[1].value : undefined;
    const imageWarnings = imageResults.flatMap((result, index) => result.status === 'rejected'
      ? [`${index === 0 ? 'Assembled' : 'Exploded'} image: ${result.reason instanceof Error ? result.reason.message : 'generation failed.'}`]
      : []);
    const imageWarning = imageWarnings.length ? imageWarnings.join(' ') : undefined;
    let hotspots = explodedImage ? fallbackHotspots(enriched.parts) : undefined;
    if (explodedImage) {
      report({ stage: 'mapping', message: `Mapping ${enriched.parts.length} clickable component regions onto the exploded render…` });
      try {
        hotspots = await locateHotspots(connection, explodedImage, enriched.parts);
        report({ stage: 'mapping', message: 'Clickable component map complete.' });
      } catch (error) {
        console.warn('Using fallback hotspot layout', error);
        report({ stage: 'mapping', message: 'Using the non-overlapping fallback component map.' });
      }
    }
    let atlas: FoundryAtlas = {
      subject: enriched.subject,
      subtitle: enriched.subtitle,
      category: enriched.category,
      summary: enriched.summary,
      accuracyNote: enriched.accuracyNote,
      parts: enriched.parts,
      sources: enriched.sources,
      image,
      imageAlt: `Photorealistic AI-generated assembled reference view of ${normalized.subject}`,
      explodedImage,
      explodedImageAlt: `Photorealistic AI-generated conceptual exploded view of ${normalized.subject}`,
      imageOrientation: enriched.imageOrientation,
      hotspots,
      mode: 'generated',
      generatedAt: new Date().toISOString(),
    };
    let cacheWarning: string | undefined;
    try {
      report({ stage: 'save', message: 'Saving the atlas and image pair to the shared gallery…' });
      atlas = await saveAtlasToGallery(atlas, prompt);
      report({ stage: 'done', message: 'Atlas complete and ready for instant reuse.' });
    } catch (error) {
      console.warn('Atlas generated but could not be added to the gallery', error);
      cacheWarning = 'The atlas was generated, but the shared gallery could not save it this time.';
      report({ stage: 'done', message: 'Atlas complete; the gallery save was unavailable.' });
    }
    return NextResponse.json({
      atlas,
      cached: false,
      imageWarning,
      cacheWarning,
      researchModel: connection.researchModel,
      imageModel: connection.imageModel,
    });
  } catch (error) {
    console.error('Atlas generation failed', error);
    return NextResponse.json({ error: 'The atlas could not be generated. Please try a more specific subject.' }, { status: 500 });
  }
  };

  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        try {
          const response = await run((entry) => send({ type: 'progress', ...entry }));
          const payload = await response.json();
          send({ type: 'result', status: response.status, payload });
        } catch (error) {
          console.error('Atlas progress stream failed', error);
          send({ type: 'result', status: 500, payload: { error: 'The atlas could not be generated.' } });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  return run(() => undefined);
}
