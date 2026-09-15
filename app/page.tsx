'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  Layers3,
  LoaderCircle,
  Play,
  Search,
  Send,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { CURRENT_INTELLIGENCE_VERSION, TESLA_DEMO, type AtlasGalleryItem, type AtlasPart, type FoundryAtlas } from './foundry-data';
import { trackAnalytics } from './analytics-client';

const examples = ['data center', 'Falcon 9', 'Tesla', 'espresso machine', 'a male human body'];

function supplierSummary(part: AtlasPart) {
  const suppliers = part.suppliers ?? [];
  if (!suppliers.length) return '';
  const first = suppliers[0];
  const prefix = first.relationshipStatus === 'confirmed' ? '' : `${first.relationshipStatus.toUpperCase()} · `;
  return `${prefix}${first.company}${first.ticker ? ` · ${first.ticker}` : ''}${suppliers.length > 1 ? ` +${suppliers.length - 1}` : ''}`;
}

function supplierStatusLabel(status: NonNullable<AtlasPart['suppliers']>[number]['relationshipStatus']) {
  return status === 'confirmed' ? 'Confirmed' : status === 'reported' ? 'Reported' : 'Rumor';
}

function supplierResearchLabel(status: NonNullable<AtlasPart['supplierResearch']>['status']) {
  if (status === 'sourced') return 'Sourced relationships found';
  if (status === 'searched-no-specific-evidence') return 'Searched · no specific evidence';
  if (status === 'not-applicable') return 'No external supplier expected';
  return 'Research incomplete';
}

function useCompactLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

function targetPosition(index: number, count: number, compact: boolean) {
  const columns = compact ? 2 : count <= 8 ? 3 : 4;
  const rows = Math.ceil(count / columns);
  const row = Math.floor(index / columns);
  const col = index % columns;
  const itemsInRow = Math.min(columns, count - row * columns);
  const x = itemsInRow === 1 ? 50 : 10 + (col * 80) / (itemsInRow - 1);
  const top = compact ? 10 : rows > 3 ? 11 : 17;
  const bottom = compact ? 90 : rows > 3 ? 89 : 83;
  const y = rows === 1 ? 50 : top + (row * (bottom - top)) / (rows - 1);
  return { x, y };
}

function sourceForPart(atlas: FoundryAtlas, part: AtlasPart) {
  return atlas.sources.filter((source) => part.sourceUrls.includes(source.url));
}

function primaryHotspot(atlas: FoundryAtlas, partId: string) {
  const hotspot = atlas.hotspots?.[partId];
  return Array.isArray(hotspot) ? hotspot[0] : hotspot;
}

type VendorEntry = {
  company: string;
  ticker: string | null;
  partIds: string[];
};

type BuildJournalEntry = {
  stage: string;
  message: string;
};

type AtlasPayload = {
  atlas?: FoundryAtlas;
  error?: string;
  code?: string;
  imageWarning?: string;
  cacheWarning?: string;
  cached?: boolean;
  draft?: boolean;
  enrichmentPending?: boolean;
  enriched?: boolean;
};

async function readAtlasResponse(response: Response, onProgress: (stage: string, message: string) => void) {
  let payload: AtlasPayload = {};
  let resultStatus = response.status;
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) {
    return { payload: await response.json() as AtlasPayload, resultStatus };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const processLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type?: string; stage?: string; message?: string; status?: number; payload?: AtlasPayload };
    if (event.type === 'progress' && event.message) onProgress(event.stage ?? 'build', event.message);
    if (event.type === 'result') {
      payload = event.payload ?? {};
      resultStatus = event.status ?? resultStatus;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
    if (done) break;
  }
  processLine(buffer);
  return { payload, resultStatus };
}

function pendingAtlas(subject: string): FoundryAtlas {
  return {
    subject,
    subtitle: 'Research build in progress',
    category: 'Pending source-backed classification',
    summary: `Researching ${subject}, its component architecture, connections, and potential suppliers.`,
    accuracyNote: 'This placeholder contains no component claims. It is replaced only when the requested subject finishes successfully.',
    parts: [],
    sources: [],
    imageOrientation: 'landscape',
    mode: 'generated',
  };
}

export default function FoundryHome() {
  const compact = useCompactLayout();
  const workbenchRef = useRef<HTMLElement>(null);
  const activeRequestRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState('Tesla');
  const [atlas, setAtlas] = useState<FoundryAtlas>(TESLA_DEMO);
  const [explode, setExplode] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [activeLayer, setActiveLayer] = useState('All layers');
  const [activeSystem, setActiveSystem] = useState('All systems');
  const [partQuery, setPartQuery] = useState('');
  const [activeVendor, setActiveVendor] = useState<string | null>(null);
  const [vendorsOpen, setVendorsOpen] = useState(false);
  const [gallery, setGallery] = useState<AtlasGalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [buildSubject, setBuildSubject] = useState('');
  const [buildJournal, setBuildJournal] = useState<BuildJournalEntry[]>([]);
  const [notice, setNotice] = useState('');
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'shared'>('idle');
  const lastExplosionEventRef = useRef(-1);
  const randomArchiveRequestedRef = useRef(false);

  const archiveLayers = useMemo(() => atlas.archive?.layers.map((layer) => layer.label) ?? [], [atlas.archive]);
  const systems = useMemo(() => {
    const inLayer = activeLayer === 'All layers' ? atlas.parts : atlas.parts.filter((part) => (part.archiveLayer ?? 'Overview') === activeLayer);
    return ['All systems', ...Array.from(new Set(inLayer.map((part) => part.system)))];
  }, [activeLayer, atlas.parts]);
  const vendors = useMemo(() => {
    const entries = new Map<string, VendorEntry>();
    for (const part of atlas.parts) {
      for (const supplier of part.suppliers ?? []) {
        const key = supplier.company.toLowerCase();
        const current = entries.get(key) ?? { company: supplier.company, ticker: supplier.ticker, partIds: [] };
        if (!current.partIds.includes(part.id)) current.partIds.push(part.id);
        if (!current.ticker && supplier.ticker) current.ticker = supplier.ticker;
        entries.set(key, current);
      }
    }
    return [...entries.values()].sort((a, b) => a.company.localeCompare(b.company));
  }, [atlas.parts]);
  const visibleParts = useMemo(() => {
    const term = partQuery.trim().toLowerCase();
    return atlas.parts.filter((part) => {
      const inLayer = activeLayer === 'All layers' || (part.archiveLayer ?? 'Overview') === activeLayer;
      const inSystem = activeSystem === 'All systems' || part.system === activeSystem;
      const inVendor = !activeVendor || (part.suppliers ?? []).some((supplier) => supplier.company === activeVendor);
      const supplierTerms = (part.suppliers ?? []).map((supplier) => `${supplier.company} ${supplier.ticker ?? ''} ${supplier.role ?? ''} ${supplier.relationshipStatus} ${supplier.note}`).join(' ');
      const connectionTerms = (part.connections ?? []).map((connection) => `${connection.relationship} ${connection.description} ${connection.toPartId}`).join(' ');
      const matches = !term || `${part.name} ${part.system} ${part.sourceId} ${supplierTerms} ${connectionTerms}`.toLowerCase().includes(term);
      return inLayer && inSystem && inVendor && matches;
    });
  }, [activeLayer, activeSystem, activeVendor, atlas.parts, partQuery]);
  const inventoryLayoutParts = useMemo(
    () => activeLayer === 'All layers' ? atlas.parts : atlas.parts.filter((part) => (part.archiveLayer ?? 'Overview') === activeLayer),
    [activeLayer, atlas.parts],
  );
  const visiblePartIds = useMemo(() => new Set(visibleParts.map((part) => part.id)), [visibleParts]);
  const selectedPart = visiblePartIds.has(selectedId) ? atlas.parts.find((part) => part.id === selectedId) : undefined;
  const auditedPartCount = atlas.parts.filter((part) => part.supplierResearch && part.supplierResearch.status !== 'incomplete').length;
  const sourcedPartCount = atlas.parts.filter((part) => part.suppliers?.length).length;
  const selectedSources = selectedPart ? sourceForPart(atlas, selectedPart) : [];
  const selectedConnections = (selectedPart?.connections ?? []).flatMap((connection) => {
    const part = atlas.parts.find((candidate) => candidate.id === connection.toPartId);
    return part ? [{ connection, part }] : [];
  });
  const hasIllustratedExplosion = Boolean(atlas.explodedImage) && (!atlas.archive || activeLayer === 'Overview');
  const showingEveryPart = activeSystem === 'All systems'
    && !activeVendor
    && !partQuery.trim()
    && visibleParts.length === inventoryLayoutParts.length;
  const supplierCount = vendors.length;
  // Ease the illustrated regions outward early so the intermediate view reads as
  // a product coming apart, rather than every component shrinking into one pile.
  const explosionSpread = Math.sqrt(explode);

  async function refreshGallery() {
    try {
      const response = await fetch('/api/gallery', { cache: 'no-store' });
      const payload = await response.json() as { items?: AtlasGalleryItem[] };
      if (response.ok) setGallery(payload.items ?? []);
    } catch {
      // The two curated editions remain available if shared storage is offline.
    } finally {
      setGalleryLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/gallery', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() as { items?: AtlasGalleryItem[] } }))
      .then(({ response, payload }) => {
        if (!response.ok) return;
        const items = payload.items ?? [];
        setGallery(items);

        // A shared atlas URL must remain stable. Plain homepage visits rotate
        // through complete illustrated archives, avoiding the previous pick so
        // each reload reveals a different subject when more than one exists.
        const hasSharedAtlas = new URLSearchParams(window.location.search).has('atlas');
        if (hasSharedAtlas || randomArchiveRequestedRef.current || items.length === 0) return;
        randomArchiveRequestedRef.current = true;

        const illustratedItems = items.filter((item) => item.image && item.explodedImage);
        const completePool = illustratedItems.length > 0 ? illustratedItems : items;
        let previousKey = '';
        try {
          previousKey = window.sessionStorage.getItem('explode-anything:last-random-atlas') ?? '';
        } catch {
          // Storage may be unavailable in strict privacy modes; random loading still works.
        }
        const choices = completePool.length > 1
          ? completePool.filter((item) => item.cacheKey !== previousKey)
          : completePool;
        const randomItem = choices[Math.floor(Math.random() * choices.length)];
        if (!randomItem) return;
        try {
          window.sessionStorage.setItem('explode-anything:last-random-atlas', randomItem.cacheKey);
        } catch {
          // The selected archive can still open without remembering the previous choice.
        }
        trackAnalytics('random_archive_open', { atlas: randomItem.subject, cacheKey: randomItem.cacheKey });
        void openGalleryAtlas(randomItem);
      })
      .catch(() => undefined)
      .finally(() => setGalleryLoading(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const atlasKey = params.get('atlas');
    if (!atlasKey) return;

    const applyView = (nextAtlas: FoundryAtlas) => {
      const partId = params.get('part') ?? '';
      const requestedLayer = params.get('layer');
      const requestedSystem = params.get('system');
      const requestedVendor = params.get('vendor');
      const requestedExplosion = Number(params.get('explode'));
      if (partId && nextAtlas.parts.some((part) => part.id === partId)) setSelectedId(partId);
      if (requestedLayer && (requestedLayer === 'All layers' || nextAtlas.archive?.layers.some((layer) => layer.label === requestedLayer))) setActiveLayer(requestedLayer);
      if (requestedSystem && (requestedSystem === 'All systems' || nextAtlas.parts.some((part) => part.system === requestedSystem))) setActiveSystem(requestedSystem);
      if (requestedVendor && nextAtlas.parts.some((part) => part.suppliers?.some((supplier) => supplier.company === requestedVendor))) setActiveVendor(requestedVendor);
      if (Number.isFinite(requestedExplosion)) setExplode(Math.max(0, Math.min(1, requestedExplosion / 100)));
      requestAnimationFrame(() => workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    if (atlasKey === 'tesla') {
      setPrompt(TESLA_DEMO.subject);
      loadAtlas(TESLA_DEMO, 'Opened a shared Tesla explosion.');
      applyView(TESLA_DEMO);
      trackAnalytics('shared_atlas_open', { atlas: TESLA_DEMO.subject, cacheKey: atlasKey });
      return;
    }

    const abortController = new AbortController();
    activeAbortRef.current = abortController;
    const sharedSubject = params.get('subject') ?? 'Shared atlas';
    setPrompt(sharedSubject);
    setAtlas(pendingAtlas(sharedSubject));
    setGenerating(true);
    setBuildSubject(sharedSubject);
    setBuildJournal([{ stage: 'share', message: 'Opening the shared explosion from the gallery…' }]);
    fetch(`/api/gallery?key=${encodeURIComponent(atlasKey)}`, { cache: 'no-store', signal: abortController.signal })
      .then(async (response) => ({ response, payload: await response.json() as { atlas?: FoundryAtlas; error?: string } }))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.atlas || payload.atlas.cacheKey !== atlasKey) throw new Error(payload.error ?? 'This shared atlas is temporarily unavailable.');
        loadAtlas(payload.atlas, 'Opened the shared explosion.');
        applyView(payload.atlas);
        trackAnalytics('shared_atlas_open', { atlas: payload.atlas.subject, cacheKey: atlasKey });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setNotice(error instanceof Error ? error.message : 'This shared atlas is temporarily unavailable.');
      })
      .finally(() => {
        setGenerating(false);
        activeAbortRef.current = null;
      });
    return () => abortController.abort();
  }, []);

  useEffect(() => {
    const rounded = Math.round(explode * 10) * 10;
    if (rounded === lastExplosionEventRef.current) return;
    const timeout = window.setTimeout(() => {
      lastExplosionEventRef.current = rounded;
      trackAnalytics('explosion_change', { atlas: atlas.subject, amount: rounded, layer: activeLayer });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [activeLayer, atlas.subject, explode]);

  useEffect(() => {
    if (!trailerOpen && !shareMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setTrailerOpen(false);
      setShareMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [shareMenuOpen, trailerOpen]);

  function loadAtlas(nextAtlas: FoundryAtlas, message: string) {
    setAtlas(nextAtlas);
    setExplode(0);
    const initialLayer = nextAtlas.archive?.layers.find((layer) => layer.id === 'overview')?.label ?? 'All layers';
    setActiveLayer(initialLayer);
    setActiveSystem('All systems');
    setActiveVendor(null);
    setPartQuery('');
    setSelectedId('');
    setNotice(message);
  }

  function openCuratedAtlas(nextAtlas: FoundryAtlas, message: string) {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    activeRequestRef.current += 1;
    setGenerating(false);
    setEnriching(false);
    setPrompt(nextAtlas.subject);
    trackAnalytics('gallery_open', { atlas: nextAtlas.subject, source: 'curated' });
    loadAtlas(nextAtlas, message);
  }

  async function generateAtlas(subject: string) {
    activeAbortRef.current?.abort();
    const abortController = new AbortController();
    activeAbortRef.current = abortController;
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    requestAnimationFrame(() => workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setAtlas(pendingAtlas(subject));
    setExplode(0);
    setActiveLayer('All layers');
    setActiveSystem('All systems');
    setActiveVendor(null);
    setPartQuery('');
    setSelectedId('');
    setBuildSubject(subject);
    setBuildJournal([{ stage: 'request', message: `Preparing a source-backed build plan for ${subject}…` }]);
    setGenerating(true);
    setEnriching(false);
    setNotice('Building a fast first draft now. Detailed supplier and IP research will continue after it appears.');
    let draftDelivered = false;
    try {
      const response = await fetch('/api/generate-atlas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ prompt: subject, phase: 'draft' }),
        signal: abortController.signal,
      });
      const { payload, resultStatus } = await readAtlasResponse(response, (stage, message) => {
        if (requestId === activeRequestRef.current) setBuildJournal((entries) => [...entries, { stage, message }].slice(-14));
      });
      if (resultStatus < 200 || resultStatus >= 300 || !payload.atlas) {
        if (payload.code === 'NOT_CONFIGURED') {
          throw new Error('Live generation needs an OPENAI_API_KEY on the server. The curated Tesla and verified human atlases are ready to show now.');
        }
        throw new Error(payload.error ?? 'The atlas could not be generated.');
      }
      const completion = payload.cached
        ? 'Loaded instantly from the shared gallery. No research or rendering was needed.'
        : payload.draft
          ? 'First draft ready. Every component is explorable while supplier and IP research continues.'
        : payload.imageWarning
          ? `Research complete. ${payload.imageWarning}`
          : payload.cacheWarning
            ? `Research and rendering complete. ${payload.cacheWarning}`
            : 'Component, supplier/IP, rendering, and gallery research complete. Select any numbered component to inspect it.';
      if (requestId !== activeRequestRef.current) return;
      loadAtlas(payload.atlas, completion);
      draftDelivered = Boolean(payload.draft);
      trackAnalytics('atlas_result', { query: subject, atlas: payload.atlas.subject, status: 'success', cached: Boolean(payload.cached) });
      setGenerating(false);
      if (payload.draft && payload.atlas.cacheKey) void refreshGallery();
      if (payload.enrichmentPending && payload.atlas.cacheKey) {
        setEnriching(true);
        setNotice('First draft ready. You can explore and use the explosion slider while detailed supplier and IP research continues.');
        const enrichmentResponse = await fetch('/api/generate-atlas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
          body: JSON.stringify({ prompt: subject, phase: 'enrich' }),
          signal: abortController.signal,
        });
        const enrichment = await readAtlasResponse(enrichmentResponse, (stage, message) => {
          if (requestId === activeRequestRef.current) setBuildJournal((entries) => [...entries, { stage, message }].slice(-14));
        });
        if (requestId !== activeRequestRef.current) return;
        if (enrichment.resultStatus >= 200 && enrichment.resultStatus < 300 && enrichment.payload.atlas) {
          setAtlas(enrichment.payload.atlas);
          setNotice('Supplier and IP research complete. This finished edition is now saved for instant reuse.');
          trackAnalytics('atlas_result', { query: subject, atlas: enrichment.payload.atlas.subject, status: 'enriched', cached: false });
          void refreshGallery();
        } else {
          setNotice(enrichment.payload.error ?? 'The first draft remains available; detailed supplier research can be retried later.');
        }
      } else if (!payload.cached) {
        void refreshGallery();
      }
    } catch (error) {
      if (requestId !== activeRequestRef.current) return;
      const message = error instanceof Error ? error.message : 'The atlas could not be generated.';
      if (draftDelivered) {
        setNotice('The first draft remains fully usable. Detailed supplier research was interrupted and can be retried later.');
        trackAnalytics('atlas_result', { query: subject, atlas: atlas.subject, status: 'enrichment-failed', error: message });
        return;
      }
      setAtlas((current) => ({
        ...current,
        subtitle: 'Build did not complete',
        summary: `${current.subject} remains the active request. ${message}`,
      }));
      setNotice(message);
      trackAnalytics('atlas_result', { query: subject, status: 'failed', error: message });
    } finally {
      if (requestId === activeRequestRef.current) {
        activeAbortRef.current = null;
        setGenerating(false);
        setEnriching(false);
      }
    }
  }

  async function openGalleryAtlas(item: AtlasGalleryItem) {
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    activeAbortRef.current?.abort();
    const abortController = new AbortController();
    activeAbortRef.current = abortController;
    setPrompt(item.subject);
    setAtlas(pendingAtlas(item.subject));
    setExplode(0);
    setActiveLayer('All layers');
    setActiveSystem('All systems');
    setActiveVendor(null);
    setPartQuery('');
    setSelectedId('');
    setBuildSubject(item.subject);
    setBuildJournal([{ stage: 'cache', message: 'Opening the finished atlas from the shared gallery…' }]);
    setGenerating(true);
    setEnriching(false);
    setNotice(`Opening ${item.subject} from the shared gallery…`);
    trackAnalytics('gallery_open', { atlas: item.subject, cacheKey: item.cacheKey, source: 'shared' });
    requestAnimationFrame(() => workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    try {
      const response = await fetch(`/api/gallery?key=${encodeURIComponent(item.cacheKey)}`, { cache: 'no-store', signal: abortController.signal });
      const payload = await response.json() as { atlas?: FoundryAtlas; error?: string };
      if (requestId !== activeRequestRef.current) return;
      if (!response.ok || !payload.atlas) throw new Error(payload.error ?? 'That gallery atlas is temporarily unavailable.');
      if (payload.atlas.cacheKey && payload.atlas.cacheKey !== item.cacheKey) {
        throw new Error(`Gallery identity mismatch: expected ${item.subject}, so the returned record was not opened.`);
      }
      loadAtlas(payload.atlas, item.intelligenceVersion === CURRENT_INTELLIGENCE_VERSION
        ? 'Loaded instantly from the shared gallery. No research or rendering was needed.'
        : 'Loaded the saved edition instantly. Its supplier intelligence can be upgraded without hiding this record.');
    } catch (error) {
      if (requestId !== activeRequestRef.current) return;
      setNotice(error instanceof Error ? error.message : 'That gallery atlas is temporarily unavailable.');
    } finally {
      if (requestId === activeRequestRef.current) {
        activeAbortRef.current = null;
        setGenerating(false);
      }
    }
  }

  function chooseVendor(vendor: VendorEntry) {
    const nextVendor = activeVendor === vendor.company ? null : vendor.company;
    trackAnalytics('vendor_select', { atlas: atlas.subject, vendor: vendor.company, selected: Boolean(nextVendor) });
    setActiveVendor(nextVendor);
    setActiveLayer('All layers');
    setActiveSystem('All systems');
    setPartQuery('');
    if (nextVendor) {
      setSelectedId(vendor.partIds[0] ?? '');
      setExplode(1);
    }
  }

  async function shareExplosion(method: 'copy' | 'native' | 'x') {
    const isTesla = atlas.mode === 'curated' && /tesla/i.test(atlas.subject);
    const atlasKey = atlas.cacheKey ?? (isTesla ? 'tesla' : '');
    if (!atlasKey) {
      setNotice('This atlas is still being archived. Its share link will be ready as soon as the build finishes.');
      return;
    }
    const url = new URL(window.location.origin);
    url.searchParams.set('atlas', atlasKey);
    url.searchParams.set('subject', atlas.subject);
    url.searchParams.set('explode', String(Math.round(explode * 100)));
    if (selectedPart) url.searchParams.set('part', selectedPart.id);
    if (activeLayer !== 'All layers') url.searchParams.set('layer', activeLayer);
    if (activeSystem !== 'All systems') url.searchParams.set('system', activeSystem);
    if (activeVendor) url.searchParams.set('vendor', activeVendor);
    const title = `${atlas.subject} — Explode Anything`;
    const text = selectedPart
      ? `Explore ${selectedPart.name} inside the ${atlas.subject} explosion.`
      : `Explore the ${atlas.subject} component explosion.`;
    try {
      if (method === 'x') {
        const intent = new URL('https://x.com/intent/post');
        intent.searchParams.set('text', text);
        intent.searchParams.set('url', url.toString());
        window.open(intent.toString(), '_blank', 'noopener,noreferrer');
        setShareStatus('shared');
      } else if (method === 'native' && typeof navigator.share === 'function') {
        await navigator.share({ title, text, url: url.toString() });
        setShareStatus('shared');
      } else {
        await navigator.clipboard.writeText(url.toString());
        setShareStatus('copied');
      }
      setShareMenuOpen(false);
      trackAnalytics('atlas_share', {
        atlas: atlas.subject,
        component: selectedPart?.name ?? null,
        amount: Math.round(explode * 100),
        method: method === 'x' ? 'x' : method === 'native' && typeof navigator.share === 'function' ? 'native' : 'clipboard',
      });
      window.setTimeout(() => setShareStatus('idle'), 2200);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setNotice(`Share this link: ${url.toString()}`);
    }
  }

  async function buildAtlas(event: FormEvent) {
    event.preventDefault();
    const subject = prompt.trim();
    if (!subject || generating) return;
    trackAnalytics('query_submit', { query: subject });
    if (/\b(human|anatomy|bodyparts3d)\b/i.test(subject)) {
      trackAnalytics('atlas_result', { query: subject, atlas: 'Adult male anatomy', status: 'success', cached: true });
      window.location.assign('/human');
      return;
    }
    if (/\btesla\b/i.test(subject)) {
      trackAnalytics('atlas_result', { query: subject, atlas: 'Tesla', status: 'success', cached: true });
      openCuratedAtlas(TESLA_DEMO, 'Loaded the curated cross-generation Tesla systems and supplier atlas.');
      return;
    }
    await generateAtlas(subject);
  }

  const stageState = explode < 0.08 ? 'ASSEMBLED OBJECT' : explode > 0.88 ? (hasIllustratedExplosion ? 'EXPLODED SYSTEMS' : 'COMPONENT INVENTORY') : 'SEPARATING SYSTEMS';
  const stageInstruction = hasIllustratedExplosion && explode >= 0.22 ? `${stageState} · CLICK A PART` : stageState;

  return (
    <main className="foundry-shell">
      <div className="foundry-grain" />
      <header className="foundry-header">
        <Link className="foundry-brand" href="/" aria-label="Explode Anything home">
          <span className="foundry-brand-mark"><i /><i /><i /></span>
          <span><strong>EXPLODE</strong><small>ANYTHING / 01</small></span>
        </Link>
        <div className="foundry-header-note"><span>RESEARCH</span><i /><span>ASSEMBLE</span><i /><span>EXPLORE</span></div>
        <div className="foundry-header-actions">
          <button type="button" className="trailer-link" onClick={() => setTrailerOpen(true)}><Play /> <span>Watch trailer</span></button>
          <Link className="human-link" href="/human"><Box /> <span>Verified 3D human atlas</span> <ChevronRight /></Link>
        </div>
      </header>

      <section className="foundry-command" aria-label="Create an atlas">
        <div className="command-copy">
          <span className="foundry-eyebrow"><Sparkles /> GENERATIVE OBJECT INDEX</span>
          <h1>What do you want to<br /><em>take apart?</em></h1>
          <p>Research any object, map its major systems, and turn the result into a sourced, clickable exploded atlas.</p>
        </div>
        <form className="foundry-form" onSubmit={buildAtlas}>
          <Search aria-hidden="true" />
          <Input value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={160} aria-label="Object to explore" placeholder="A telescope, a sneaker, a steam engine…" />
          <Button type="submit" disabled={generating}>
            {generating ? <LoaderCircle className="spin" /> : <Sparkles />}
            <span>{generating ? 'Building' : 'Build atlas'}</span>
            {!generating && <ArrowRight />}
          </Button>
        </form>
        <div className="foundry-examples" aria-label="Example subjects">
          <span>TRY</span>
          {examples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}
        </div>
        {notice && <button type="button" className="foundry-notice" onClick={() => setNotice('')}><CircleAlert /> <span>{notice}</span><X /></button>}
      </section>

      <section className="foundry-gallery" aria-label="Saved atlas gallery">
        <div className="foundry-gallery-head">
          <div><span className="foundry-section-number">SAVED / SHARED GALLERY</span><h2>Ready to open instantly</h2></div>
          <small>{galleryLoading ? 'CHECKING ARCHIVE…' : `${gallery.length + 2} ATLASES AVAILABLE`}</small>
        </div>
        <div className="foundry-gallery-track">
          <button type="button" className="foundry-gallery-card" title="Tesla electric vehicle" onClick={() => openCuratedAtlas(TESLA_DEMO, 'Loaded the curated cross-generation Tesla systems and supplier atlas.')}>
            <span className="gallery-image"><img src="/tesla-exploded-v2.jpg" alt="Exploded Tesla systems atlas" /></span>
            <span className="gallery-card-copy"><small>CURATED / ENGINEERED PRODUCT</small><strong>Tesla</strong><em>{TESLA_DEMO.parts.length} parts · {new Set(TESLA_DEMO.parts.flatMap((part) => (part.suppliers ?? []).map((supplier) => supplier.company))).size} vendors</em></span>
            <ChevronRight />
            <span className="gallery-full-title" role="tooltip">Tesla electric vehicle</span>
          </button>
          <Link className="foundry-gallery-card" href="/human" title="Adult male anatomy">
            <span className="gallery-image portrait"><img src="/og.png" alt="Verified adult male anatomy atlas" /></span>
            <span className="gallery-card-copy"><small>VERIFIED / BODYParts3D</small><strong>Adult male anatomy</strong><em>Official mesh edition</em></span>
            <ChevronRight />
            <span className="gallery-full-title" role="tooltip">Adult male anatomy</span>
          </Link>
          {gallery.map((item) => (
            <button type="button" className="foundry-gallery-card" key={item.cacheKey} title={item.subject} onClick={() => void openGalleryAtlas(item)} disabled={generating}>
              <span className={`gallery-image${item.imageOrientation === 'portrait' ? ' portrait' : ''}`}>
                {item.explodedImage ?? item.image ? (
                  <img
                    src={item.explodedImage ?? item.image}
                    alt={`Exploded ${item.subject} atlas`}
                    loading="lazy"
                    decoding="async"
                    fetchPriority="low"
                  />
                ) : <Box />}
              </span>
              <span className="gallery-card-copy"><small>{item.intelligenceVersion === CURRENT_INTELLIGENCE_VERSION ? `SAVED / ${item.category}` : 'SAVED / RESEARCH REFRESH'}</small><strong>{item.subject}</strong><em>{item.partCount} parts · {item.supplierCount} vendors</em></span>
              <ChevronRight />
              <span className="gallery-full-title" role="tooltip">{item.subject}</span>
            </button>
          ))}
        </div>
      </section>

      <section ref={workbenchRef} className="foundry-workbench" aria-label={`${atlas.subject} component atlas`}>
        <aside className="foundry-index">
          <div className="foundry-section-number">01 / INDEX</div>
          <div className="foundry-subject">
            <span>{atlas.category}</span>
            <h2>{atlas.subject}</h2>
            <p>{atlas.subtitle}</p>
          </div>
          <label className="foundry-part-search">
            <Search />
            <Input value={partQuery} onChange={(event) => setPartQuery(event.target.value)} placeholder="Find a component" />
          </label>
          {archiveLayers.length ? (
            <div className="foundry-layer-index">
              <span>RESEARCH LAYERS</span>
              {archiveLayers.map((layer) => {
                const count = atlas.parts.filter((part) => (part.archiveLayer ?? 'Overview') === layer).length;
                return (
                  <button type="button" key={layer} className={activeLayer === layer && !activeVendor ? 'active' : ''} onClick={() => {
                    trackAnalytics('filter_change', { atlas: atlas.subject, filter: 'layer', value: layer });
                    setActiveLayer(layer);
                    setActiveSystem('All systems');
                    setActiveVendor(null);
                    setPartQuery('');
                    setSelectedId(atlas.parts.find((part) => (part.archiveLayer ?? 'Overview') === layer)?.id ?? '');
                    if (layer !== 'Overview') setExplode(1);
                  }}>
                    <span>{layer}</span><small>{String(count).padStart(2, '0')}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="foundry-system-list">
            {systems.map((system) => {
              const layerParts = activeLayer === 'All layers' ? atlas.parts : atlas.parts.filter((part) => (part.archiveLayer ?? 'Overview') === activeLayer);
              const count = system === 'All systems' ? layerParts.length : layerParts.filter((part) => part.system === system).length;
              return (
                <button type="button" key={system} className={activeSystem === system && !activeVendor ? 'active' : ''} onClick={() => {
                  trackAnalytics('filter_change', { atlas: atlas.subject, filter: 'system', value: system });
                  setActiveSystem(system);
                  setActiveVendor(null);
                  setSelectedId(system === 'All systems' ? '' : (layerParts.find((part) => part.system === system)?.id ?? ''));
                }}>
                  <span>{system}</span><small>{String(count).padStart(2, '0')}</small>
                </button>
              );
            })}
          </div>
          <div className={`foundry-vendor-index${vendorsOpen ? ' open' : ''}`}>
            <button type="button" className="vendor-index-toggle" onClick={() => setVendorsOpen((open) => !open)} aria-expanded={vendorsOpen}>
              <span>VENDORS</span><small>{String(vendors.length).padStart(2, '0')}</small><ChevronRight />
            </button>
            {vendorsOpen && (
              <div className="vendor-index-list">
                {auditedPartCount ? <p className="vendor-coverage">COMPONENT AUDIT · {auditedPartCount}/{atlas.parts.length} CHECKED · {sourcedPartCount} WITH RELATIONSHIPS</p> : null}
                {vendors.length ? vendors.map((vendor) => (
                  <button type="button" key={vendor.company} className={activeVendor === vendor.company ? 'active' : ''} onClick={() => chooseVendor(vendor)}>
                    <span><strong>{vendor.company}</strong><em>{vendor.ticker ?? 'PRIVATE'}</em></span>
                    <small>{vendor.partIds.length} {vendor.partIds.length === 1 ? 'PART' : 'PARTS'}</small>
                  </button>
                )) : <p>{enriching ? 'Researching suppliers and IP in the background…' : 'No sourced vendors for this atlas.'}</p>}
              </div>
            )}
          </div>
          <div className="foundry-mode">
            <i className={atlas.mode === 'generated' ? 'generated' : ''} />
            <span><strong>{atlas.buildStage === 'draft' ? 'Fast first draft' : atlas.mode === 'generated' ? 'AI research atlas' : 'Curated demonstration'}</strong><small>{atlas.parts.length} components{atlas.buildStage === 'draft' ? ' · supplier research running' : supplierCount ? ` · ${supplierCount} vendors` : ''}</small></span>
          </div>
        </aside>

        <section className="foundry-stage">
          <div className="foundry-stage-head">
            <span>{activeVendor ? `${activeVendor.toUpperCase()} SUPPLY MAP · CLICK A PART` : stageInstruction}</span>
            <div className="foundry-stage-actions">
              <span>{String(visibleParts.length).padStart(2, '0')} VISIBLE / {String(atlas.parts.length).padStart(2, '0')} TOTAL</span>
              <div className="foundry-share-control">
                <button
                  type="button"
                  className="foundry-share-trigger"
                  onClick={() => setShareMenuOpen((open) => !open)}
                  disabled={generating || !atlas.parts.length}
                  aria-label={`Share ${atlas.subject} explosion`}
                  aria-haspopup="menu"
                  aria-expanded={shareMenuOpen}
                >
                  {shareStatus === 'idle' ? <Share2 /> : <Check />}
                  <span>{shareStatus === 'shared' ? 'SHARED' : shareStatus === 'copied' ? 'LINK COPIED' : 'SHARE'}</span>
                </button>
                {shareMenuOpen && (
                  <div className="foundry-share-menu" role="menu" aria-label="Share options">
                    <button type="button" role="menuitem" className="share-on-x" onClick={() => void shareExplosion('x')}><ExternalLink /><span>SHARE ON X</span></button>
                    <button type="button" role="menuitem" onClick={() => void shareExplosion('copy')}><Copy /><span>COPY LINK</span></button>
                    <button type="button" role="menuitem" onClick={() => void shareExplosion('native')}><Send /><span>SHARE VIA…</span></button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="foundry-stage-grid" aria-hidden="true" />
          {(generating || enriching) && (
            <div className={`foundry-build-journal${enriching ? ' background' : ''}`} role="status" aria-live="polite">
              <div className="build-journal-title"><LoaderCircle className="spin" /><span>{generating ? 'FIRST DRAFT' : 'SUPPLIER RESEARCH'} / {buildSubject.toUpperCase()}</span></div>
              <div className="build-journal-feed">
                {buildJournal.map((entry, index) => (
                  <p key={`${entry.stage}-${index}`} style={{ opacity: 0.28 + ((index + 1) / Math.max(buildJournal.length, 1)) * 0.68 }}>
                    <i>{entry.stage}</i><span>{entry.message}</span>
                  </p>
                ))}
              </div>
              <small>{generating ? 'The component atlas and image pair arrive first.' : 'The atlas is usable now. Detailed supplier, generation, alternate-vendor, and IP evidence is being added in the background.'}</small>
            </div>
          )}
          <div
            className={`foundry-assembly${hasIllustratedExplosion ? ' rich-assembled' : ''}${atlas.imageOrientation === 'portrait' ? ' portrait' : ''}`}
            style={{
              opacity: hasIllustratedExplosion ? Math.max(0, Math.min(1, 1 - (explode - 0.12) / 0.68)) : Math.max(0.12, 1 - explode * 0.9),
              transform: `translate(-50%, -50%) scale(${1 - explode * (hasIllustratedExplosion ? 0.06 : 0.16)})`,
            }}
          >
            {atlas.image ? (
              <img
                src={atlas.image}
                alt={atlas.imageAlt ?? `Assembled ${atlas.subject}`}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            ) : (
              <div className="foundry-visual-fallback">
                {generating ? <LoaderCircle className="spin" /> : <Box />}
                <span>{generating ? 'ASSEMBLED IMAGE GENERATING' : atlas.parts.length ? 'ASSEMBLED IMAGE UNAVAILABLE' : 'BUILD INTERRUPTED — TRY AGAIN'}</span>
              </div>
            )}
            <span className="assembly-axis axis-x" /><span className="assembly-axis axis-y" />
          </div>
          {hasIllustratedExplosion && (
            <div
              className={`foundry-exploded-visual${atlas.imageOrientation === 'portrait' ? ' portrait' : ''}`}
              style={{
                transform: `translate(-50%, -50%) scale(${0.97 + explode * 0.03})`,
              }}
            >
              <img
                className="foundry-exploded-base"
                src={atlas.explodedImage}
                alt={atlas.explodedImageAlt ?? `Conceptual exploded view of ${atlas.subject}`}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                style={{
                  opacity: showingEveryPart
                    ? Math.max(0, Math.min(1, (explode - 0.7) / 0.3))
                    : Math.max(0, Math.min(0.72, (explode - 0.1) * 1.15)),
                }}
              />
              {selectedPart && selectedConnections.length > 0 && !activeVendor && (
                <svg className="foundry-connection-lines" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ opacity: Math.max(0, Math.min(1, (explode - 0.22) * 2.2)) }} aria-hidden="true">
                  {selectedConnections.flatMap(({ connection, part }) => {
                    const from = primaryHotspot(atlas, selectedPart.id);
                    const to = primaryHotspot(atlas, part.id);
                    if (!from || !to || !visibleParts.some((candidate) => candidate.id === part.id)) return [];
                    const x1 = 50 + (from.x - 50) * explosionSpread;
                    const y1 = 46 + (from.y - 46) * explosionSpread;
                    const x2 = 50 + (to.x - 50) * explosionSpread;
                    const y2 = 46 + (to.y - 46) * explosionSpread;
                    return (
                      <g key={`${selectedPart.id}-${part.id}-${connection.relationship}`} className={`connection-${connection.relationship}`}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} />
                        <circle cx={x2} cy={y2} r="0.75" />
                      </g>
                    );
                  })}
                </svg>
              )}
              {explode > 0.04 && <div className="foundry-part-layers" aria-hidden="true">
                {visibleParts.flatMap((part) => {
                  const hotspot = atlas.hotspots?.[part.id];
                  if (!hotspot) return [];
                  const regions = Array.isArray(hotspot) ? hotspot : [hotspot];
                  const active = part.id === selectedPart?.id;
                  return regions.map((region, regionIndex) => {
                    const width = region.width ?? 9;
                    const height = region.height ?? 9;
                    const top = Math.max(0, region.y - height / 2);
                    const right = Math.max(0, 100 - region.x - width / 2);
                    const bottom = Math.max(0, 100 - region.y - height / 2);
                    const left = Math.max(0, region.x - width / 2);
                    const shiftX = (50 - region.x) * (1 - explosionSpread);
                    const shiftY = (46 - region.y) * (1 - explosionSpread);
                    return (
                      <div
                        key={`${part.id}-layer-${regionIndex}`}
                        className={`foundry-part-layer${active ? ' active' : ''}`}
                        style={{
                          clipPath: `inset(${top}% ${right}% ${bottom}% ${left}% round 4%)`,
                          opacity: Math.max(0, Math.min(1, (explode - 0.18) / 0.68)),
                          transform: `translate(${shiftX}%, ${shiftY}%) scale(${0.72 + explosionSpread * 0.28})`,
                          transformOrigin: `${region.x}% ${region.y}%`,
                        }}
                      >
                        <img src={atlas.explodedImage} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                      </div>
                    );
                  });
                })}
              </div>}
              <span className="foundry-art-badge" style={{ opacity: Math.max(0, Math.min(1, (explode - 0.16) * 3)) }}>AI-ILLUSTRATED · DOCUMENTED SYSTEMS · NOT SERVICE GEOMETRY</span>
              <div className="foundry-hotspots" aria-label="Clickable component regions" style={{ opacity: Math.max(0, Math.min(1, (explode - 0.12) * 4)) }}>
                {visibleParts.flatMap((part) => {
                  const hotspot = atlas.hotspots?.[part.id];
                  if (!hotspot) return [];
                  const regions = Array.isArray(hotspot) ? hotspot : [hotspot];
                  const partIndex = atlas.parts.findIndex((candidate) => candidate.id === part.id);
                  const active = part.id === selectedPart?.id;
                  return regions.map((region, regionIndex) => (
                    <button
                      type="button"
                      key={`${part.id}-${regionIndex}`}
                      className={`foundry-hotspot${active ? ' active' : ''}`}
                      style={{
                        left: `${50 + (region.x - 50) * explosionSpread}%`,
                        top: `${46 + (region.y - 46) * explosionSpread}%`,
                        width: `${(region.width ?? 9) * (0.72 + explosionSpread * 0.28)}%`,
                        height: `${(region.height ?? 9) * (0.72 + explosionSpread * 0.28)}%`,
                        '--part-color': part.color,
                      } as CSSProperties}
                      disabled={explode < 0.12}
                      onClick={() => { setSelectedId(part.id); trackAnalytics('component_select', { atlas: atlas.subject, component: part.name, componentId: part.id, surface: 'exploded-image' }); }}
                      aria-label={`Select ${part.name}${part.suppliers?.length ? `, with ${part.suppliers.length} supplier ${part.suppliers.length === 1 ? 'record' : 'records'}` : ''}`}
                      aria-pressed={active}
                    >
                      <i>{String(partIndex + 1).padStart(2, '0')}</i>
                      <span><strong>{part.name}</strong>{part.suppliers?.length ? <small>{supplierSummary(part)}</small> : null}</span>
                    </button>
                  ));
                })}
              </div>
            </div>
          )}
          {!hasIllustratedExplosion && <div className="foundry-parts" aria-label="Clickable component inventory">
            {inventoryLayoutParts.filter((part) => !visiblePartIds.has(part.id)).map((part) => {
              const layoutIndex = inventoryLayoutParts.findIndex((candidate) => candidate.id === part.id);
              const target = targetPosition(layoutIndex, inventoryLayoutParts.length, compact);
              const left = 50 + (target.x - 50) * explosionSpread;
              const top = 50 + (target.y - 50) * explosionSpread;
              return (
                <div
                  aria-hidden="true"
                  key={`${part.id}-context`}
                  className="foundry-part-node context"
                  style={{ left: `${left}%`, top: `${top}%`, opacity: Math.min(0.2, Math.max(0, (explode - 0.08) * 0.5)), '--part-color': part.color } as CSSProperties}
                >
                  <i>{String(layoutIndex + 1).padStart(2, '0')}</i>
                  <span><strong>{part.name}</strong><small>{part.system}</small></span>
                </div>
              );
            })}
            {visibleParts.map((part) => {
              const layoutIndex = inventoryLayoutParts.findIndex((candidate) => candidate.id === part.id);
              const target = targetPosition(layoutIndex, inventoryLayoutParts.length, compact);
              const left = 50 + (target.x - 50) * explosionSpread;
              const top = 50 + (target.y - 50) * explosionSpread;
              const active = part.id === selectedPart?.id;
              return (
                <button
                  type="button"
                  key={part.id}
                  className={`foundry-part-node${active ? ' active' : ''}`}
                  style={{ left: `${left}%`, top: `${top}%`, opacity: Math.min(1, Math.max(0, (explode - 0.08) * 2.5)), '--part-color': part.color } as CSSProperties}
                  disabled={explode < 0.12}
                  onClick={() => { setSelectedId(part.id); trackAnalytics('component_select', { atlas: atlas.subject, component: part.name, componentId: part.id, surface: 'inventory' }); }}
                >
                  <i>{String(layoutIndex + 1).padStart(2, '0')}</i>
                  <span><strong>{part.name}</strong><small>{supplierSummary(part) || part.system}</small></span>
                </button>
              );
            })}
          </div>}
          {visibleParts.length === 0 && <div className="foundry-empty">No components match this filter.</div>}
          <div className="foundry-slider glass-panel">
            <div><Layers3 /><span>EXPLOSION</span><output>{Math.round(explode * 100)}%</output></div>
            <Slider aria-label="Explosion amount" min={0} max={100} step={1} value={[explode * 100]} onValueChange={(value) => setExplode((Array.isArray(value) ? value[0] : value) / 100)} />
            <div className="foundry-slider-labels"><span>ASSEMBLED</span><span>{hasIllustratedExplosion ? 'EXPLODED VIEW' : 'INVENTORY'}</span></div>
          </div>
        </section>

        <aside className="foundry-detail">
          <div className="foundry-section-number">02 / OBJECT RECORD</div>
          {selectedPart ? (
            <>
              <div className="detail-index-row"><span style={{ background: selectedPart.color }} /> <small>{selectedPart.system}</small><code>{selectedPart.sourceId}</code></div>
              <h2>{selectedPart.name}</h2>
              <p>{selectedPart.description}</p>
              <dl>
                <div><dt>Evidence</dt><dd>{selectedPart.confidence}</dd></div>
                <div><dt>References</dt><dd>{selectedSources.length || 'Catalog'}</dd></div>
              </dl>
              {selectedPart.supplierResearch ? (
                <div className={`supplier-audit ${selectedPart.supplierResearch.status}`}>
                  <span>SUPPLIER RESEARCH</span>
                  <strong>{supplierResearchLabel(selectedPart.supplierResearch.status)}</strong>
                  <p>{selectedPart.supplierResearch.summary}</p>
                </div>
              ) : null}
              {selectedPart.suppliers?.length ? (
                <div className="foundry-suppliers">
                  <span>SUPPLIERS / VENDORS</span>
                  {selectedPart.suppliers.map((supplier) => (
                    <div className={`foundry-supplier ${supplier.relationshipStatus}`} key={`${supplier.company}-${supplier.relationshipStatus}-${supplier.note}`}>
                      <div className="supplier-heading">
                        <i>{supplierStatusLabel(supplier.relationshipStatus)}</i>
                        <strong>{supplier.company}</strong>
                        <small>{`${(supplier.role ?? 'component supplier').replaceAll('-', ' ')} · ${supplier.isPublicCompany ? `${supplier.exchange} · ${supplier.ticker}` : 'PRIVATE COMPANY · NO PUBLIC TICKER'}`}</small>
                      </div>
                      <p>{supplier.note}</p>
                      <div className="supplier-links">
                        <a href={supplier.evidenceUrl} target="_blank" rel="noreferrer" aria-label={`Open evidence for ${supplier.company}`}>
                          EVIDENCE <ExternalLink />
                        </a>
                        {supplier.financeUrl ? (
                          <a href={supplier.financeUrl} target="_blank" rel="noreferrer" aria-label={`View ${supplier.company} on Yahoo Finance`}>
                            YAHOO FINANCE <ExternalLink />
                          </a>
                        ) : <span className="supplier-private">PRIVATE VENDOR</span>}
                      </div>
                    </div>
                  ))}
                  <p className="supplier-disclaimer">Roles distinguish makers, assemblers, designers, IP licensors, software/material providers, and integrators. Relationships may be current, former, alternate, or generation-specific. Reported and rumor labels are sourced claims—not confirmation or investment advice.</p>
                </div>
              ) : null}
              {selectedConnections.length ? (
                <div className="foundry-connections-list">
                  <span>CONNECTIONS / POWER · DATA · THERMAL · PHYSICAL</span>
                  {selectedConnections.map(({ connection, part }) => (
                    <button type="button" key={`${connection.toPartId}-${connection.relationship}`} onClick={() => { setSelectedId(part.id); setActiveLayer(part.archiveLayer ?? 'Overview'); setActiveSystem('All systems'); setActiveVendor(null); setPartQuery(''); setExplode((amount) => Math.max(amount, 0.72)); trackAnalytics('component_select', { atlas: atlas.subject, component: part.name, componentId: part.id, surface: 'connection' }); }}>
                      <i className={`connection-${connection.relationship}`}>{connection.relationship}</i>
                      <span><strong>{part.name}</strong><small>{connection.description}</small></span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="foundry-citations">
                <span>SUPPORTING SOURCES</span>
                {selectedSources.length ? selectedSources.map((source) => (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                    <span><strong>{source.title}</strong><small>{source.publisher}</small></span><ExternalLink />
                  </a>
                )) : <p>See the full source register below.</p>}
              </div>
            </>
          ) : (
            <div className="foundry-object-overview">
              <div className="detail-index-row"><span /><small>{atlas.category}</small><code>{atlas.mode === 'generated' ? 'RESEARCH ATLAS' : 'CURATED ATLAS'}</code></div>
              <h2>{atlas.subject}</h2>
              <p>{atlas.summary}</p>
              <dl>
                <div><dt>Components</dt><dd>{atlas.parts.length}</dd></div>
                <div><dt>Vendors</dt><dd>{supplierCount || 'Researching'}</dd></div>
              </dl>
              {atlas.archive ? <p className="overview-archive-note">MULTILEVEL ARCHIVE · {atlas.archive.layers.length} RESEARCH LAYERS</p> : null}
              <p className="overview-instruction">Move the explosion slider, then click any numbered component to open its evidence, suppliers, IP roles, connections, and sources.</p>
            </div>
          )}
        </aside>
      </section>

      <section className="foundry-footnotes">
        <div><span className="foundry-section-number">03 / RESEARCH NOTE</span><p>{atlas.summary}</p></div>
        <div className="source-register"><span className="foundry-section-number">SOURCE REGISTER</span>{atlas.sources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><i>{String(index + 1).padStart(2, '0')}</i><span>{source.publisher}</span><ExternalLink /></a>)}</div>
      </section>

      {trailerOpen ? (
        <div className="trailer-modal" role="presentation" onClick={() => setTrailerOpen(false)}>
          <section className="trailer-dialog" role="dialog" aria-modal="true" aria-label="Explode Anything trailer" onClick={(event) => event.stopPropagation()}>
            <div className="trailer-dialog-head"><span>EXPLODE ANYTHING / 27 SECOND TOUR</span><button type="button" onClick={() => setTrailerOpen(false)} aria-label="Close trailer"><X /></button></div>
            <video src="https://explodeanything.com/video/explode-anything-trailer.mp4?v=3" controls autoPlay playsInline preload="metadata" poster="https://explodeanything.com/video/trailer-poster.jpg?v=3" />
          </section>
        </div>
      ) : null}
    </main>
  );
}
