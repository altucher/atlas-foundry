import { NextResponse } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';

import { cacheKeyForPrompt, loadCachedAtlas, saveAtlasToGallery } from '@/app/atlas-store';
import { CURRENT_INTELLIGENCE_VERSION, type AtlasHotspot, type AtlasPart, type AtlasSource, type FoundryAtlas } from '@/app/foundry-data';

export const runtime = 'nodejs';
// Deep generic architectures can spend several minutes in source-backed research
// before the matched image and hotspot passes begin. Vercel Pro/Enterprise Fluid
// compute permits up to 800 seconds; deployments need a plan that accepts it.
export const maxDuration = 800;

// Luna makes the first useful atlas arrive quickly. Deeper archive passes retain
// Terra, and the forensic named-product supplier audit retains Astra.
const defaultResearchModel = 'gpt-5.6-luna';
const defaultDeepResearchModel = 'gpt-5.6-terra';
const defaultInitialSupplierResearchModel = 'gpt-5.6-terra';
const defaultSupplierResearchModel = 'gpt-6-astra';
const defaultImageModel = 'gpt-image-2.5-flare';
const requestWindows = new Map<string, number[]>();
const windowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 3;
const supplierRoles = ['manufacturer', 'assembler', 'designer', 'ip-licensor', 'software-provider', 'material-supplier', 'integrator', 'other'] as const;
const dataCenterDeepLayers = [
  {
    id: 'site-building',
    label: 'Site & building',
    focus: 'site selection interfaces, civil works, building shell, structural bays, loading and staging, utility entrances, grounding, lightning protection, physical rooms, containment boundaries, and maintainable facility pathways',
  },
  {
    id: 'electrical-chain',
    label: 'Electrical chain',
    focus: 'utility service through substations, transformers, medium-voltage and low-voltage switchgear, generators and fuel, transfer systems, UPS internals and energy storage, busway, PDUs, rack PDUs, branch protection, grounding, telemetry, and board-level conversion to accelerator rails',
  },
  {
    id: 'thermal-water',
    label: 'Thermal & water',
    focus: 'heat rejection and water paths from chillers, cooling towers or dry coolers through pumps, valves, heat exchangers, treatment, CRAH/in-row systems, containment, CDUs, manifolds, quick disconnects, cold plates, immersion alternatives, leak detection, and controls',
  },
  {
    id: 'rack-silicon',
    label: 'Rack to silicon',
    focus: 'rack mechanics, shelves, compute sleds, chassis, motherboards, CPUs, GPUs and accelerators, DPUs, memory, storage media and controllers, power shelves, VRMs, BMCs, firmware, substrates, packaging, chiplets, cooling interfaces, connectors, cables, and licensed IP',
  },
  {
    id: 'network-storage',
    label: 'Network, optics & storage',
    focus: 'carrier entrances and meet-me rooms through ODFs, structured fiber, leaf/spine and management fabrics, NICs, DPUs, switches, copper and optical links, DSPs, lasers, modulators, photodiodes, connectors, DCI, storage nodes, media, fabrics, and data-protection paths',
  },
  {
    id: 'controls-safety',
    label: 'Controls, safety & operations',
    focus: 'BMS, EPMS, DCIM, orchestration, telemetry sensors, time synchronization, access control, video security, fire detection and suppression, life safety, environmental monitoring, spares, maintenance isolation, commissioning, and operating interfaces',
  },
] as const;
const falconNineDeepLayers = [
  {
    id: 'airframe-tanks',
    label: 'Airframe & tanks',
    focus: 'first- and second-stage primary structures, aluminum-lithium tank barrels, domes, common structural interfaces, LOX and RP-1 tank volumes, pressurization vessels and lines, feedline penetrations, thrust structures, raceways, fairings, payload adapter, coatings, seals, insulation, and documented manufacturing or material relationships',
  },
  {
    id: 'merlin-propulsion',
    label: 'Merlin & propulsion',
    focus: 'Merlin 1D and Merlin Vacuum engine assemblies and supported subassemblies: injector, chamber, regeneratively cooled jacket, turbopump, gas generator, valves, TEA-TEB ignition, gimbal actuators, nozzle and niobium extension, engine controllers, propellant manifolds, octaweb, plumbing, sensors, and engine-out architecture',
  },
  {
    id: 'staging-payload',
    label: 'Staging & payload',
    focus: 'interstage, pneumatic stage-separation hardware, pushers and latches, second-stage interfaces, payload attach fittings, deployment hardware, payload fairing halves, acoustic and environmental provisions, venting, mission-specific adapters, rideshare hardware, and supported recovery or reuse details for fairings',
  },
  {
    id: 'avionics-flight',
    label: 'Avionics & flight',
    focus: 'flight computers, engine controllers, guidance navigation and control, inertial and satellite navigation sensors, telemetry, antennas, tracking, command paths, batteries, power distribution, wiring, connectors, pressure and temperature sensing, flight software, cybersecurity boundaries, autonomous flight safety, licensed IP, and documented electronic-component relationships',
  },
  {
    id: 'recovery-reuse',
    label: 'Recovery & reuse',
    focus: 'boostback, entry and landing architecture; nitrogen cold-gas thrusters, hypersonic grid fins and actuation, entry protection, landing burn engine selection, deployable landing legs, crush cores, footpads, hydraulic or electric actuation where documented, navigation aids, droneship interfaces, hold-down and lifting points, inspection, refurbishment, and reuse-related generation changes',
  },
  {
    id: 'ground-mission',
    label: 'Ground & mission interfaces',
    focus: 'Falcon 9 vehicle-to-pad and vehicle-to-mission interfaces: transporter-erector strongback connections, hold-down and release, propellant and helium loading interfaces, electrical and data umbilicals, purge and environmental control, launch mount flame interface, payload access, range and tracking links, recovery assets, and generation- or site-specific variations without treating ground equipment as flying hardware',
  },
] as const;
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
  deepResearchModel: string;
  initialSupplierResearchModel: string;
  supplierResearchModel: string;
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
  const configuredDeepResearchModel = process.env.OPENAI_DEEP_RESEARCH_MODEL ?? defaultDeepResearchModel;
  const configuredInitialSupplierResearchModel = process.env.OPENAI_INITIAL_SUPPLIER_RESEARCH_MODEL ?? defaultInitialSupplierResearchModel;
  const configuredSupplierResearchModel = process.env.OPENAI_SUPPLIER_RESEARCH_MODEL ?? defaultSupplierResearchModel;
  const configuredImageModel = process.env.OPENAI_IMAGE_MODEL ?? defaultImageModel;
  const directApiKey = process.env.OPENAI_API_KEY;

  if (directApiKey) {
    return {
      apiKey: directApiKey,
      baseUrl: 'https://api.openai.com/v1',
      researchModel: directOpenAiModel(configuredResearchModel),
      deepResearchModel: directOpenAiModel(configuredDeepResearchModel),
      initialSupplierResearchModel: directOpenAiModel(configuredInitialSupplierResearchModel),
      supplierResearchModel: directOpenAiModel(configuredSupplierResearchModel),
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
      deepResearchModel: gatewayModel(configuredDeepResearchModel),
      initialSupplierResearchModel: gatewayModel(configuredInitialSupplierResearchModel),
      supplierResearchModel: gatewayModel(configuredSupplierResearchModel),
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
          sourceUrls: { type: 'array', items: { type: 'string' }, maxItems: 20 },
          confidence: { type: 'string', enum: ['high', 'medium', 'contextual'] },
          connections: {
            type: 'array',
            minItems: 0,
            maxItems: 16,
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
            maxItems: 16,
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
  required: ['sources', 'relationships', 'coverage'],
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
    coverage: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        required: ['partId', 'status', 'summary'],
        properties: {
          partId: { type: 'string' },
          status: { type: 'string', enum: ['sourced', 'searched-no-specific-evidence', 'not-applicable'] },
          summary: { type: 'string' },
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
  coverage: Array<{
    partId: string;
    status: 'sourced' | 'searched-no-specific-evidence' | 'not-applicable';
    summary: string;
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
    const suppliers = [...supplierMap.values()].slice(0, 16);
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
      sourceUrls: sourceUrls.slice(0, 20),
      suppliers: suppliers.length ? suppliers : undefined,
      supplierResearch: part.supplierResearch && ['sourced', 'searched-no-specific-evidence', 'not-applicable', 'incomplete'].includes(part.supplierResearch.status)
        ? { status: part.supplierResearch.status, summary: part.supplierResearch.summary.trim().slice(0, 360) }
        : undefined,
      archiveLayer: part.archiveLayer?.trim().slice(0, 64) || undefined,
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
      .slice(0, 16),
  }));
  return {
    ...raw,
    imageOrientation: raw.imageOrientation === 'portrait' ? 'portrait' as const : 'landscape' as const,
    sources,
    parts: connectedParts,
  };
}

function archiveSlug(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 68) || 'component';
}

function archiveNameKey(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function subjectMatchesRequest(requested: string, returned: string) {
  const stopWords = new Set(['a', 'an', 'the', 'of', 'and', 'for', 'with', 'system', 'systems', 'component', 'components', 'atlas']);
  const terms = (value: string) => new Set(value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\bnine\b/g, '9')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !stopWords.has(term)));
  const requestedTerms = terms(requested);
  const returnedTerms = terms(returned);
  if (!requestedTerms.size || !returnedTerms.size) return false;
  return [...requestedTerms].some((term) => returnedTerms.has(term));
}

type ArchiveLayerDefinition = { readonly id: string; readonly label: string; readonly focus: string };

function mergeArchiveLayers(
  base: FoundryAtlas,
  additions: Array<{ layer: ArchiveLayerDefinition; atlas: FoundryAtlas }>,
  config: {
    canonicalKey: string;
    aliases: string[];
    idPrefix: string;
    subject: string;
    subtitle: (partCount: number) => string;
    summary: string;
    accuracyNote: string;
    overviewFocus: string;
  },
) {
  const sourcesByUrl = new Map(base.sources.map((source) => [source.url, source]));
  const parts: AtlasPart[] = base.parts.map((part) => ({ ...part, archiveLayer: part.archiveLayer ?? 'Overview' }));
  const usedIds = new Set(parts.map((part) => part.id));
  const partIndexByName = new Map(parts.map((part, index) => [archiveNameKey(part.name), index]));

  for (const { layer, atlas } of additions) {
    for (const source of atlas.sources) if (!sourcesByUrl.has(source.url)) sourcesByUrl.set(source.url, source);
    const idMap = new Map<string, string>();
    for (const part of atlas.parts) {
      const existingIndex = partIndexByName.get(archiveNameKey(part.name));
      if (existingIndex !== undefined) {
        idMap.set(part.id, parts[existingIndex].id);
        continue;
      }
      const stem = `${config.idPrefix}-${layer.id}-${archiveSlug(part.name)}`;
      let id = stem;
      let suffix = 2;
      while (usedIds.has(id)) id = `${stem}-${suffix++}`;
      usedIds.add(id);
      idMap.set(part.id, id);
    }

    for (const incoming of atlas.parts) {
      const id = idMap.get(incoming.id)!;
      const remappedConnections = (incoming.connections ?? []).flatMap((connection) => {
        const toPartId = idMap.get(connection.toPartId);
        return toPartId && toPartId !== id ? [{ ...connection, toPartId }] : [];
      });
      const existingIndex = parts.findIndex((part) => part.id === id);
      if (existingIndex === -1) {
        const next = { ...incoming, id, archiveLayer: layer.label, connections: remappedConnections };
        partIndexByName.set(archiveNameKey(next.name), parts.length);
        parts.push(next);
        continue;
      }

      const existing = parts[existingIndex];
      const supplierMap = new Map([...(existing.suppliers ?? []), ...(incoming.suppliers ?? [])]
        .map((supplier) => [`${supplier.company}|${supplier.role}|${supplier.relationshipStatus}|${supplier.evidenceUrl}`.toLowerCase(), supplier]));
      const connectionMap = new Map([...(existing.connections ?? []), ...remappedConnections]
        .map((connection) => [`${connection.toPartId}|${connection.relationship}|${connection.description}`.toLowerCase(), connection]));
      parts[existingIndex] = {
        ...existing,
        description: incoming.description.length > existing.description.length ? incoming.description : existing.description,
        sourceUrls: [...new Set([...existing.sourceUrls, ...incoming.sourceUrls])].slice(0, 30),
        suppliers: [...supplierMap.values()].slice(0, 16),
        supplierResearch: (existing.suppliers?.length || incoming.suppliers?.length)
          ? { status: 'sourced', summary: incoming.supplierResearch?.summary ?? existing.supplierResearch?.summary ?? 'Sourced supplier relationships were retained across archive passes.' }
          : incoming.supplierResearch ?? existing.supplierResearch,
        connections: [...connectionMap.values()].slice(0, 20),
      };
    }
  }

  const layerMetadata = new Map((base.archive?.layers ?? [{
    id: 'overview', label: 'Overview', focus: config.overviewFocus,
    partCount: base.parts.filter((part) => !part.archiveLayer || part.archiveLayer === 'Overview').length,
    generatedAt: base.generatedAt ?? new Date().toISOString(),
  }]).map((layer) => [layer.id, layer]));
  for (const { layer, atlas } of additions) {
    layerMetadata.set(layer.id, {
      ...layer,
      partCount: atlas.parts.length,
      generatedAt: atlas.generatedAt ?? new Date().toISOString(),
    });
  }

  return {
    ...base,
    subject: config.subject,
    subtitle: config.subtitle(parts.length),
    summary: `${base.summary} ${config.summary}`,
    accuracyNote: `${base.accuracyNote} ${config.accuracyNote}`,
    parts,
    sources: [...sourcesByUrl.values()].map((source, index) => ({ ...source, id: `source-${index + 1}` })),
    archive: {
      canonicalKey: config.canonicalKey,
      aliases: config.aliases,
      layers: [...layerMetadata.values()],
    },
    generatedAt: new Date().toISOString(),
  } satisfies FoundryAtlas;
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

async function generateResearchWithFallback(
  connection: AiConnection,
  body: Record<string, unknown>,
  report: ProgressReporter,
  progress?: { stage: ProgressStage; message: string },
) {
  try {
    return await generateResearchInBackground(connection, body, report, progress);
  } catch (firstError) {
    const fallbackId = String(body.model ?? '').includes('terra') ? 'gpt-5.6-luna' : 'gpt-5.6-terra';
    const fallbackModel = connection.baseUrl === 'https://api.openai.com/v1' ? fallbackId : gatewayModel(fallbackId);
    const tools = Array.isArray(body.tools)
      ? body.tools.map((tool) => tool && typeof tool === 'object' && 'type' in tool && tool.type === 'web_search'
        ? { ...tool, search_context_size: 'low' }
        : tool)
      : body.tools;
    console.warn(`Research attempt with ${String(body.model)} failed; retrying with ${fallbackModel}`, firstError);
    report({
      stage: progress?.stage ?? 'research',
      message: `The research provider ended the first connection; retrying automatically with ${fallbackId} and a bounded source window…`,
    });
    return generateResearchInBackground(connection, {
      ...body,
      model: fallbackModel,
      reasoning: { effort: 'low' },
      tools,
    }, report, progress);
  }
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
  const instructions = `You are a forensic component-supply-chain researcher. Investigate potential vendors for EVERY component id supplied. Give roughly equal research effort to every id; do not stop after easy, famous chips or top-level assemblers. For each component, separately search (1) the exact current product or configuration, (2) older and newer product-family generations, (3) alternate or multisource vendors, (4) factory, geography, model-year, trim, and revision differences, and (5) relevant embedded IP and lower-tier manufacturing roles. Return every defensible current, former, alternative, generation-specific, factory-specific, regional, or credible published rumored relationship supported by a returned source. Several companies may be returned for one component.

Distinguish the vendor's role precisely: manufacturer, assembler, designer, IP licensor, software provider, material supplier, integrator, or other. Treat cell makers and battery-pack assemblers as different roles; likewise distinguish a display-panel maker from the finished display-module assembler, a semiconductor foundry from a chip designer or IP licensor, and a component maker from the product's contract assembler. Include relevant licensed architecture, protocol, codec, semiconductor, software, or other embedded IP only when a source establishes it.

For displays, investigate the panel maker, display-module assembly, backlight or emissive stack, driver/timing electronics, cover material, and product-generation allocation separately when those roles are relevant to the supplied ids. For batteries, distinguish cell maker, pack assembler, protection/BMS electronics, connector/flex, and material supplier. Apply equivalent sub-tier decomposition to cameras, storage, memory, networking, power electronics, thermal systems, motors, braking, steering, structures, and other engineered assemblies. A relationship belongs only on the closest supplied component id that the evidence supports.

For a specific named product, only connect a vendor to a component when the evidence explicitly ties it to that product, product family, teardown, generation, model year, trim, market, factory, or period. A general corporate supplier list confirms that a company supplies the brand, but by itself does not prove which component it supplies. Use it as corroboration, not as an invented component mapping. For a generic category, a relationship may show that the vendor makes or sells that exact component class; the note must call it a representative market offering and not evidence of deployment in one facility.

For a named product, do not return the product's own brand as an integrator, service-parts provider, or component vendor merely because it publishes a manual, specifies the component, sells a replacement assembly, or integrates the finished product. That relationship is inherent and adds no supplier intelligence. Retain the brand owner only for a genuinely component-specific design, software, or IP role—for example its authored SoC design or operating-system software—and state that role narrowly.

Set confirmed only for first-party statements, regulatory records, procurement records, direct component markings/teardowns, or customer/supplier material that establishes the relationship. Set reported for a credible established technical, industry, or financial publication. Set rumored only when a real returned publication explicitly makes the claim. Do not convert repetition, resale listings, repair-shop marketing, or visual resemblance into evidence.

Each note must state the role, exact product/version/time scope, whether the relationship is current, historical, alternative, or uncertain, and what the cited source actually establishes. Every evidenceUrl must exactly match one URL in sources. Use real HTTPS URLs consulted in this pass. Set current public-company ticker, exchange, and exact Yahoo symbol; use null for all three private-company fields. Return no relationship when evidence is inadequate.

Coverage is an audit ledger, not a confidence performance. Return exactly one coverage entry for every supplied partId. Use sourced when at least one retained relationship is backed by a component-specific source; searched-no-specific-evidence when you searched the avenues above but found no sufficiently specific relationship; and not-applicable only when the item genuinely has no external vendor or IP relationship to research. The summary must briefly state which product-family/current/historical avenues were checked and why evidence was retained or withheld. Never omit a supplied partId.`;
  report({ stage: 'vendor', message: `Supplier evidence pass ${batchIndex + 1}/${batchCount} · checking ${parts.length} components individually…` });
  const payload = await generateResearchWithFallback(connection, {
    model: connection.supplierResearchModel,
    reasoning: { effort: 'low' },
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
  // Small batches stop famous components from consuming the search budget that
  // should have gone to less-visible assemblies such as displays and batteries.
  const batchSize = 6;
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
    return {
      ...atlas,
      parts: atlas.parts.map((part) => ({
        ...part,
        supplierResearch: {
          status: part.suppliers?.length ? 'sourced' as const : 'incomplete' as const,
          summary: part.suppliers?.length
            ? 'The architecture pass returned at least one sourced relationship, but the dedicated component audit was unavailable.'
            : 'The dedicated component-specific supplier pass was unavailable. No absence-of-supplier conclusion should be drawn.',
        },
      })),
    };
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
  const coverageByPartId = new Map(successful.flatMap((result) => result.coverage).map((coverage) => [coverage.partId, coverage]));
  const normalizedEnriched = normalizeAtlas({
    ...atlas,
    sources,
    parts: atlas.parts.map((part) => ({
      ...part,
      supplierResearch: coverageByPartId.has(part.id)
        ? {
            status: coverageByPartId.get(part.id)!.status,
            summary: coverageByPartId.get(part.id)!.summary,
          }
        : {
            status: 'incomplete',
            summary: 'The component-specific supplier pass did not return an audit record for this item. No absence-of-supplier conclusion should be drawn.',
          },
      suppliers: [
        ...(part.suppliers ?? []),
        ...relationships.filter((relationship) => relationship.partId === part.id).map((relationship) => ({ ...relationship, financeUrl: null })),
      ],
    })),
  });
  const enriched = {
    ...normalizedEnriched,
    parts: normalizedEnriched.parts.map((part) => {
      if (part.suppliers?.length) {
        return {
          ...part,
          supplierResearch: {
            status: 'sourced' as const,
            summary: part.supplierResearch?.summary || `${part.suppliers.length} claim-specific supplier or IP relationship${part.suppliers.length === 1 ? ' was' : 's were'} retained for this component.`,
          },
        };
      }
      if (part.supplierResearch?.status === 'sourced') {
        return {
          ...part,
          supplierResearch: {
            status: 'incomplete' as const,
            summary: `${part.supplierResearch.summary} The returned relationship did not pass source or company-identity validation, so it is not displayed.`,
          },
        };
      }
      return part;
    }),
  };
  const relationshipCount = enriched.parts.reduce((count, part) => count + (part.suppliers?.length ?? 0), 0);
  const companyCount = new Set(enriched.parts.flatMap((part) => (part.suppliers ?? []).map((supplier) => supplier.company))).size;
  const auditedCount = enriched.parts.filter((part) => part.supplierResearch?.status !== 'incomplete').length;
  report({ stage: 'vendor', message: `Audited ${auditedCount}/${enriched.parts.length} components and mapped ${relationshipCount} sourced relationships across ${companyCount} potential vendors, including historical and variant-specific records.` });
  return enriched;
}

async function researchDataCenterLayer(
  connection: AiConnection,
  layer: (typeof dataCenterDeepLayers)[number],
  existing: FoundryAtlas,
  report: ProgressReporter,
) {
  const existingNames = existing.parts.map((part) => `${part.id} | ${part.name}`).join('\n');
  const instructions = `Build one forensic deep-research layer for a vendor-neutral data-center archive. Focus only on: ${layer.focus}.

Return 24–36 distinct, physically or operationally identifiable components at the lowest level that public documentation can support. Work from the facility boundary toward subassemblies, board-level devices, materials, firmware, protocols, and licensed IP where relevant. Do not pad the list, repeat synonyms, or simply rename the overview records supplied below. A component may be a documented alternative architecture, but the description must say so. This is a generic reference architecture: never imply that all alternatives coexist in one facility.

Prioritize standards, public utility and government material, Open Compute Project specifications, first-party engineering manuals and product documentation, regulatory or exchange filings, credible teardowns, and strong technical publications. Every component must cite a consulted HTTPS source. Preserve meaningful power, data, thermal, fluid, mechanical, structural, and control connections among ids returned in this layer.

Capture readily established component suppliers and IP roles, including multiple current, former, alternative, regional, and credibly reported or rumored relationships when sources support them. Keep manufacturer, assembler, designer, foundry, packaging/test, material, software, protocol, and IP roles distinct. Generic-category vendors are representative offerings, never site-deployment claims. A dedicated six-component supplier audit follows, so spend most of this pass on complete technical decomposition.

Return a concise accuracy boundary and an image prompt, although this archive-deepening pass will reuse the canonical overview images. Do not provide construction procedures, hazardous electrical instructions, or operating setpoints.`;
  report({ stage: 'research', message: `Deep archive layer · ${layer.label} — decomposing documented subassemblies…` });
  const payload = await generateResearchWithFallback(connection, {
    model: connection.deepResearchModel,
    reasoning: { effort: 'low' },
    instructions,
    input: `Canonical subject: a data center\nDeep layer: ${layer.label}\n\nExisting archive records to avoid duplicating:\n${existingNames}`,
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    text: { format: { type: 'json_schema', name: `data_center_${layer.id.replaceAll('-', '_')}`, strict: true, schema: atlasSchema } },
  }, report, { stage: 'research', message: `${layer.label} deep research is still running` });
  const raw = JSON.parse(extractOutputText(payload)) as Omit<FoundryAtlas, 'mode'> & { visualPrompt: string };
  const normalized = normalizeAtlas(raw);
  const layered = {
    ...normalized,
    subject: 'Data center',
    parts: normalized.parts.map((part) => ({ ...part, archiveLayer: layer.label })),
    mode: 'generated' as const,
    generatedAt: new Date().toISOString(),
  };
  report({ stage: 'inventory', message: `${layer.label} layer mapped ${layered.parts.length} lower-level components.` });
  // Terra was exceptionally strong for generic market alternatives in the
  // overview audit; reserve Astra for opaque named-product supply chains.
  const genericSupplierConnection = { ...connection, supplierResearchModel: connection.deepResearchModel };
  const enriched = await enrichSuppliers(genericSupplierConnection, layered, report);
  return { ...enriched, mode: 'generated', generatedAt: layered.generatedAt } satisfies FoundryAtlas;
}

async function deepenDataCenterArchive(
  connection: AiConnection,
  existing: FoundryAtlas,
  report: ProgressReporter,
) {
  report({ stage: 'research', message: `Expanding the canonical data-center archive across ${dataCenterDeepLayers.length} independent technical layers…` });
  const settled = await Promise.allSettled(dataCenterDeepLayers.map(async (layer) => ({
    layer,
    atlas: await researchDataCenterLayer(connection, layer, existing, report),
  })));
  const additions = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  for (const result of settled) if (result.status === 'rejected') console.warn('Data-center deep layer failed', result.reason);
  if (!additions.length) throw new Error('Every data-center archive deepening pass was unavailable.');
  if (additions.length !== dataCenterDeepLayers.length) {
    report({ stage: 'research', message: `${additions.length}/${dataCenterDeepLayers.length} data-center deep layers completed; preserving successful layers for the archive.` });
  }
  const merged = mergeArchiveLayers(existing, additions, {
    canonicalKey: 'data-center',
    aliases: ['data center', 'a data center', 'the data center', 'data centers'],
    idPrefix: 'dc',
    subject: 'Data center',
    subtitle: (partCount) => `${partCount}-component multilevel facility-to-silicon research archive`,
    summary: 'This canonical archive adds separately explorable deep layers for site/building, the complete electrical and thermal chains, rack-to-silicon hardware, networking/optics/storage, and controls/safety/operations.',
    accuracyNote: 'Deep layers are complementary vendor-neutral alternatives and do not imply that every component or vendor is installed together.',
    overviewFocus: 'Facility-to-chip reference architecture',
  });
  report({
    stage: 'inventory',
    message: `Canonical data-center archive now contains ${merged.parts.length} components across ${merged.archive?.layers.length ?? 1} explorable levels.`,
  });
  report({ stage: 'save', message: 'Saving every completed layer under the canonical data-center archive…' });
  const saved = await saveAtlasToGallery(merged, 'data center');
  report({ stage: 'done', message: 'Multilevel data-center archive complete; all common prompt aliases now reopen this record.' });
  return saved;
}

async function researchFalconNineLayer(
  connection: AiConnection,
  layer: (typeof falconNineDeepLayers)[number],
  existing: FoundryAtlas,
  report: ProgressReporter,
) {
  const existingNames = existing.parts.map((part) => `${part.id} | ${part.name}`).join('\n');
  const instructions = `Build one forensic deep-research layer for the SpaceX Falcon 9 launch-vehicle archive. Focus only on: ${layer.focus}.

Return 24–36 distinct, physically or operationally identifiable components at the lowest level that public evidence can support. Distinguish Falcon 9 v1.0, v1.1, Full Thrust, Block 4, Block 5, Cargo Dragon, Crew Dragon, fairing, expendable and recovered missions wherever the hardware or supplier relationship changed. Treat the current Block 5 family as the reference, with earlier or mission-specific items explicitly labeled historical or variant-specific. Do not repeat overview items unless decomposing them into documented subassemblies.

Prioritize SpaceX user guides, launch and mission material, NASA, FAA and NTSB records, environmental and regulatory filings, patents, supplier disclosures, SEC or exchange filings, technical conference papers, credible technical journalism, and high-quality imagery. Do not infer proprietary construction from photographs. Every component must cite a consulted HTTPS source. Preserve meaningful power, data, thermal, fluid, mechanical, structural, control and propulsive connections among ids returned in this layer.

Audit the public supply chain as part of the architecture: retain SpaceX only for component-specific design, manufacture, software or integration that a source establishes. Search for outside manufacturers, materials, electronics, sensors, actuators, navigation and communications devices, licensed IP, foundry or fabrication, alternative generations and credible published reports. Label each relationship confirmed, reported or rumored and scope it to the exact generation, mission, period or subsystem. A dedicated component-by-component supplier pass follows.

Return a concise accuracy boundary and an image prompt, although this deepening pass reuses the canonical overview images. Do not provide hazardous propellant procedures, launch parameters, exploit-relevant software details, or step-by-step construction instructions.`;
  report({ stage: 'research', message: `Deep Falcon 9 layer · ${layer.label} — decomposing documented subassemblies…` });
  const payload = await generateResearchWithFallback(connection, {
    model: connection.deepResearchModel,
    reasoning: { effort: 'low' },
    instructions,
    input: `Canonical subject: SpaceX Falcon 9\nDeep layer: ${layer.label}\n\nExisting archive records to avoid duplicating:\n${existingNames}`,
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    text: { format: { type: 'json_schema', name: `falcon_9_${layer.id.replaceAll('-', '_')}`, strict: true, schema: atlasSchema } },
  }, report, { stage: 'research', message: `${layer.label} deep research is still running` });
  const raw = JSON.parse(extractOutputText(payload)) as Omit<FoundryAtlas, 'mode'> & { visualPrompt: string };
  const normalized = normalizeAtlas(raw);
  const layered = {
    ...normalized,
    subject: 'Falcon 9',
    parts: normalized.parts.map((part) => ({ ...part, archiveLayer: layer.label })),
    mode: 'generated' as const,
    generatedAt: new Date().toISOString(),
  };
  report({ stage: 'inventory', message: `${layer.label} layer mapped ${layered.parts.length} lower-level components.` });
  const enriched = await enrichSuppliers(connection, layered, report);
  return { ...enriched, mode: 'generated', generatedAt: layered.generatedAt } satisfies FoundryAtlas;
}

async function deepenFalconNineArchive(
  connection: AiConnection,
  existing: FoundryAtlas,
  report: ProgressReporter,
) {
  report({ stage: 'research', message: `Expanding Falcon 9 across ${falconNineDeepLayers.length} independent vehicle and mission layers…` });
  const settled = await Promise.allSettled(falconNineDeepLayers.map(async (layer) => ({
    layer,
    atlas: await researchFalconNineLayer(connection, layer, existing, report),
  })));
  const additions = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  for (const result of settled) if (result.status === 'rejected') console.warn('Falcon 9 deep layer failed', result.reason);
  if (!additions.length) throw new Error('Every Falcon 9 archive deepening pass was unavailable.');
  if (additions.length !== falconNineDeepLayers.length) {
    report({ stage: 'research', message: `${additions.length}/${falconNineDeepLayers.length} Falcon 9 deep layers completed; preserving successful layers for the archive.` });
  }
  const merged = mergeArchiveLayers(existing, additions, {
    canonicalKey: 'falcon-9',
    aliases: ['Falcon 9', 'Falcon Nine', 'SpaceX Falcon 9', 'SpaceX Falcon Nine'],
    idPrefix: 'f9',
    subject: 'Falcon 9',
    subtitle: (partCount) => `${partCount}-component multilevel launch-vehicle research archive`,
    summary: 'This canonical archive adds separately explorable layers for airframe and tanks, Merlin propulsion, staging and payload systems, avionics and flight control, recovery and reuse, and ground/mission interfaces.',
    accuracyNote: 'Deep layers distinguish Block 5, earlier generations, and mission-specific variants; they do not imply that every historical or alternative component flies together.',
    overviewFocus: 'Block 5 vehicle and mission overview',
  });
  report({ stage: 'inventory', message: `Falcon 9 archive now contains ${merged.parts.length} components across ${merged.archive?.layers.length ?? 1} explorable levels.` });
  report({ stage: 'save', message: 'Saving every completed Falcon 9 layer under one canonical archive…' });
  const saved = await saveAtlasToGallery(merged, 'Falcon 9');
  report({ stage: 'done', message: 'Multilevel Falcon 9 archive complete; common prompt aliases now reopen this record.' });
  return saved;
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
    ? 'CRITICAL COMPOSITION RULE: show exactly one complete, fully assembled object, large and centered. No second reference copy, comparison panel, exploded layout, cutaway, exposed internals, floating pieces, duplicated product, inset, or side-by-side composition. The intact object should occupy most of the frame while remaining fully visible.'
    : `Create the matching exhaustive exploded-view companion in the same camera angle, scale, backdrop, lighting, and materials. CRITICAL COMPOSITION RULE: depict the parts from exactly one product, with the product fully disassembled. There must be ZERO intact or usable assembled copies of the product anywhere in the image. Do not add a reference product, second product, comparison view, inset, duplicated display/screen, or side-by-side assembled object. Separate the outer shell, display or cover, input surfaces, internal boards, battery or power system, structural pieces, and connectors so no combination still reads as an intact product. Distribute the components broadly and evenly across the useful canvas; do not gather them into a central pile. Pull every documented component below into a distinct, generously separated, non-overlapping visual cluster. Preserve meaningful nested assemblies and repeated parts such as engine clusters, landing legs, wheels, or fairing halves. For infrastructure and generic systems, arrange the clusters so the operating topology remains readable from inputs and utilities through distribution, equipment, data paths, cooling, controls, safety systems, and outputs. Show every listed component once, preserve plausible relative scale, and fit the entire arrangement in frame. Do not invent proprietary internals; represent uncertain items only at the assembly level supported by public evidence.\n\nDocumented components:\n${componentList}`;

  let retryDirection = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await undiciFetch(`${connection.baseUrl}/images/generations`, {
      dispatcher: aiDispatcher,
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: connection.imageModel,
        prompt: `${sharedDirection} ${modeDirection}${retryDirection}`,
        size: imageOrientation === 'portrait' ? '1024x1536' : '1536x1024', quality: 'high', output_format: 'webp',
      }),
    });
    if (!response.ok) throw new Error(`Image generation failed (${response.status}).`);
    const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const generated = payload.data?.[0];
    const image = generated?.b64_json ? `data:image/webp;base64,${generated.b64_json}` : generated?.url;
    if (!image) throw new Error('Image generation returned no image.');

    try {
      const assessment = await assessGeneratedImage(connection, image, subject, mode);
      if (assessment.pass || attempt === 1) return image;
      retryDirection = `\n\nMANDATORY CORRECTION: the prior candidate was rejected by visual QA. ${assessment.issues.join(' ')} Recompose from scratch and satisfy every critical composition rule above.`;
    } catch (error) {
      console.warn('Image composition QA unavailable', error);
      return image;
    }
  }
  throw new Error('Image generation exhausted its composition attempts.');
}

async function assessGeneratedImage(
  connection: AiConnection,
  image: string,
  subject: string,
  mode: 'assembled' | 'exploded',
) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'issues'],
    properties: {
      pass: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
  } as const;
  const passRule = mode === 'assembled'
    ? 'Pass only when exactly one intact subject is shown, it is fully visible, it occupies most of the useful frame, and there is no second copy, exploded arrangement, inset, or excessive empty border.'
    : 'Pass only when zero intact assembled products are shown, no major assembly such as a display is duplicated, the visible pieces all belong to one disassembled subject, components are distinct and non-overlapping, and they are distributed across the useful frame rather than piled at its center.';
  const response = await undiciFetch(`${connection.baseUrl}/responses`, {
    dispatcher: aiDispatcher,
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.researchModel,
      reasoning: { effort: 'low' },
      instructions: `Act as a strict product-visualization quality inspector. The requested subject is ${subject}; the requested state is ${mode}. ${passRule} Ignore photorealism and component completeness for this check. List short concrete composition failures. Do not excuse a reference copy merely because other parts are exploded.`,
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: image, detail: 'high' }] }],
      text: { format: { type: 'json_schema', name: 'atlas_image_quality', strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`Image composition QA failed (${response.status}).`);
  const payload = (await response.json()) as Record<string, unknown>;
  return JSON.parse(extractOutputText(payload)) as { pass: boolean; issues: string[] };
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
            ...(request.headers.get('x-atlas-force-refresh') === '1' ? { 'X-Atlas-Force-Refresh': '1' } : {}),
            ...(request.headers.get('x-atlas-deep-build') === '1' ? { 'X-Atlas-Deep-Build': '1' } : {}),
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
  const promptCacheKey = cacheKeyForPrompt(prompt);
  const cachedAtlas = await loadCachedAtlas(promptCacheKey);
  const forceRefresh = request.headers.get('x-atlas-force-refresh') === '1';
  const deepBuildKey = request.headers.get('x-atlas-deep-build') === '1' && ['data-center', 'falcon-9'].includes(promptCacheKey)
    ? promptCacheKey
    : null;
  if (!forceRefresh && !deepBuildKey && cachedAtlas?.intelligenceVersion === CURRENT_INTELLIGENCE_VERSION) {
    report({ stage: 'done', message: `Found ${cachedAtlas.subject} in the shared gallery.` });
    return NextResponse.json({ atlas: cachedAtlas, cached: true });
  }
  if (cachedAtlas && cachedAtlas.intelligenceVersion !== CURRENT_INTELLIGENCE_VERSION) {
    report({ stage: 'cache', message: 'The saved atlas predates component-by-component supplier intelligence; rebuilding it once with the current research model…' });
  } else if (deepBuildKey) {
    report({ stage: 'cache', message: `Using the saved ${deepBuildKey === 'data-center' ? 'data-center' : 'Falcon 9'} overview as the foundation for deeper research layers…` });
  } else if (forceRefresh) {
    report({ stage: 'cache', message: 'Refreshing the saved atlas, research record, and matched image pair…' });
  }

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

  if (deepBuildKey) {
    if (!cachedAtlas || cachedAtlas.intelligenceVersion !== CURRENT_INTELLIGENCE_VERSION) {
      return NextResponse.json({ error: `Build the current ${deepBuildKey === 'data-center' ? 'data-center' : 'Falcon 9'} overview before requesting deep archive layers.` }, { status: 409 });
    }
    try {
      const atlas = deepBuildKey === 'data-center'
        ? await deepenDataCenterArchive(connection, cachedAtlas, report)
        : await deepenFalconNineArchive(connection, cachedAtlas, report);
      return NextResponse.json({
        atlas,
        cached: false,
        deepened: true,
        researchModel: connection.deepResearchModel,
        supplierResearchModel: deepBuildKey === 'data-center' ? connection.deepResearchModel : connection.supplierResearchModel,
        imageModel: connection.imageModel,
      });
    } catch (error) {
      console.error(`${deepBuildKey} archive deepening failed`, error);
      return NextResponse.json({ error: `The ${deepBuildKey === 'data-center' ? 'data-center' : 'Falcon 9'} overview is safe, but the deep archive passes could not be completed. Please retry later.` }, { status: 500 });
    }
  }

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
    const responsePayload = await generateResearchWithFallback(connection, {
        model: connection.researchModel,
        reasoning: { effort: 'none' },
        instructions,
        input: `Build a component atlas for: ${prompt}`,
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        text: { format: { type: 'json_schema', name: 'component_atlas', strict: true, schema: atlasSchema } },
    }, report);
    const rawAtlas = JSON.parse(extractOutputText(responsePayload)) as Omit<FoundryAtlas, 'mode'> & { visualPrompt: string };
    const normalized = normalizeAtlas(rawAtlas);
    if (!subjectMatchesRequest(prompt, normalized.subject)) {
      throw new Error(`Research identity mismatch: requested ${prompt}, but the provider returned ${normalized.subject}. The mismatched record was rejected and was not saved.`);
    }
    report({ stage: 'inventory', message: `Mapped ${normalized.parts.length} documented components across ${new Set(normalized.parts.map((part) => part.system)).size} systems.` });
    for (const source of normalized.sources) {
      report({ stage: 'source', message: `Source · ${source.publisher} — ${source.title}` });
    }
    report({ stage: 'render', message: 'Rendering a matched photorealistic assembled and exploded image pair…' });
    const [enriched, imageResults] = await Promise.all([
      enrichSuppliers({ ...connection, supplierResearchModel: connection.initialSupplierResearchModel }, normalized, report).catch((error) => {
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
      supplierResearchModel: connection.initialSupplierResearchModel,
      imageModel: connection.imageModel,
    });
  } catch (error) {
    console.error('Atlas generation failed', error);
    return NextResponse.json({ error: 'The research provider ended both generation attempts before completion. Your subject is valid; please retry in a few minutes.' }, { status: 500 });
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
