'use client';

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Box,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Layers3,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { TESLA_DEMO, type AtlasPart, type FoundryAtlas } from './foundry-data';

const examples = ['Tesla', 'espresso machine', 'DSLR camera', 'a male human body'];

function ElectricVehicleVisual() {
  return (
    <svg className="foundry-ev" viewBox="0 0 900 430" role="img" aria-label={TESLA_DEMO.imageAlt}>
      <defs>
        <linearGradient id="car-shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ded8ca" />
          <stop offset="0.48" stopColor="#817f79" />
          <stop offset="1" stopColor="#272a28" />
        </linearGradient>
        <linearGradient id="car-glass" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#7f9699" stopOpacity=".82" />
          <stop offset="1" stopColor="#1d2526" stopOpacity=".94" />
        </linearGradient>
        <filter id="car-shadow" x="-20%" y="-20%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      <ellipse cx="455" cy="348" rx="342" ry="30" fill="#000" opacity=".68" filter="url(#car-shadow)" />
      <path d="M103 284c9-28 35-48 78-61l127-36c48-67 109-105 183-108h72c72 8 130 45 184 111l84 28c30 10 48 28 56 55l-7 35-67 12H169l-74-14z" fill="url(#car-shell)" stroke="#e8e2d3" strokeOpacity=".32" strokeWidth="2" />
      <path d="M338 185c43-55 92-84 151-87h65c55 7 105 38 151 92l-188 1z" fill="url(#car-glass)" stroke="#c8d4d2" strokeOpacity=".23" />
      <path d="M515 102v88M335 190h370M117 283h730" stroke="#f0eadc" strokeOpacity=".15" />
      <path d="M204 248h-58M755 241l77 16" stroke="#d8bf7e" strokeWidth="5" strokeLinecap="round" opacity=".7" />
      <g>
        <circle cx="243" cy="304" r="67" fill="#131513" stroke="#aaa79e" strokeWidth="3" />
        <circle cx="243" cy="304" r="39" fill="#4e514d" stroke="#c8c4b8" strokeWidth="2" />
        <circle cx="243" cy="304" r="13" fill="#171917" />
        <circle cx="706" cy="304" r="67" fill="#131513" stroke="#aaa79e" strokeWidth="3" />
        <circle cx="706" cy="304" r="39" fill="#4e514d" stroke="#c8c4b8" strokeWidth="2" />
        <circle cx="706" cy="304" r="13" fill="#171917" />
      </g>
      <path d="M302 285h348" stroke="#d8ba6f" strokeWidth="4" strokeDasharray="5 8" opacity=".64" />
    </svg>
  );
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

export default function FoundryHome() {
  const compact = useCompactLayout();
  const [prompt, setPrompt] = useState('Tesla');
  const [atlas, setAtlas] = useState<FoundryAtlas>(TESLA_DEMO);
  const [explode, setExplode] = useState(0);
  const [selectedId, setSelectedId] = useState(TESLA_DEMO.parts[0].id);
  const [activeSystem, setActiveSystem] = useState('All systems');
  const [partQuery, setPartQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');

  const systems = useMemo(() => ['All systems', ...Array.from(new Set(atlas.parts.map((part) => part.system)))], [atlas]);
  const visibleParts = useMemo(() => {
    const term = partQuery.trim().toLowerCase();
    return atlas.parts.filter((part) => {
      const inSystem = activeSystem === 'All systems' || part.system === activeSystem;
      const matches = !term || `${part.name} ${part.system} ${part.sourceId}`.toLowerCase().includes(term);
      return inSystem && matches;
    });
  }, [activeSystem, atlas.parts, partQuery]);
  const selectedPart = atlas.parts.find((part) => part.id === selectedId) ?? visibleParts[0] ?? atlas.parts[0];
  const selectedSources = selectedPart ? sourceForPart(atlas, selectedPart) : [];
  const hasIllustratedExplosion = Boolean(atlas.explodedImage && atlas.hotspots);

  useEffect(() => {
    if (!visibleParts.some((part) => part.id === selectedId) && visibleParts[0]) setSelectedId(visibleParts[0].id);
  }, [selectedId, visibleParts]);

  async function buildAtlas(event: FormEvent) {
    event.preventDefault();
    const subject = prompt.trim();
    if (!subject || generating) return;
    if (/\b(human|anatomy|bodyparts3d)\b/i.test(subject)) {
      window.location.assign('/human');
      return;
    }
    if (/\btesla\b/i.test(subject)) {
      setAtlas(TESLA_DEMO);
      setExplode(0);
      setActiveSystem('All systems');
      setPartQuery('');
      setSelectedId(TESLA_DEMO.parts[0].id);
      setNotice('Loaded the curated Tesla systems demo. Use a different subject to test live research.');
      return;
    }
    setGenerating(true);
    setNotice('Researching primary sources, building the catalog, then rendering an assembled reference…');
    try {
      const response = await fetch('/api/generate-atlas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: subject }),
      });
      const payload = (await response.json()) as { atlas?: FoundryAtlas; error?: string; code?: string; imageWarning?: string };
      if (!response.ok || !payload.atlas) {
        if (payload.code === 'NOT_CONFIGURED') {
          throw new Error('Live generation needs an OPENAI_API_KEY on the server. The curated Tesla and verified human atlases are ready to show now.');
        }
        throw new Error(payload.error ?? 'The atlas could not be generated.');
      }
      setAtlas(payload.atlas);
      setExplode(0);
      setActiveSystem('All systems');
      setPartQuery('');
      setSelectedId(payload.atlas.parts[0]?.id ?? '');
      setNotice(payload.imageWarning ? `Research complete. ${payload.imageWarning}` : 'Research complete. Every catalog card links back to its supporting sources.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The atlas could not be generated.');
    } finally {
      setGenerating(false);
    }
  }

  const stageState = explode < 0.08 ? 'ASSEMBLED OBJECT' : explode > 0.88 ? (hasIllustratedExplosion ? 'EXPLODED SYSTEMS' : 'COMPONENT INVENTORY') : 'SEPARATING SYSTEMS';

  return (
    <main className="foundry-shell">
      <div className="foundry-grain" />
      <header className="foundry-header">
        <a className="foundry-brand" href="/" aria-label="Atlas Foundry home">
          <span className="foundry-brand-mark"><i /><i /><i /></span>
          <span><strong>ATLAS</strong><small>FOUNDRY / 01</small></span>
        </a>
        <div className="foundry-header-note"><span>RESEARCH</span><i /><span>ASSEMBLE</span><i /><span>EXPLORE</span></div>
        <a className="human-link" href="/human"><Box /> Verified 3D human atlas <ChevronRight /></a>
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

      <section className="foundry-workbench" aria-label={`${atlas.subject} component atlas`}>
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
          <div className="foundry-system-list">
            {systems.map((system) => {
              const count = system === 'All systems' ? atlas.parts.length : atlas.parts.filter((part) => part.system === system).length;
              return (
                <button type="button" key={system} className={activeSystem === system ? 'active' : ''} onClick={() => setActiveSystem(system)}>
                  <span>{system}</span><small>{String(count).padStart(2, '0')}</small>
                </button>
              );
            })}
          </div>
          <div className="foundry-mode">
            <i className={atlas.mode === 'generated' ? 'generated' : ''} />
            <span><strong>{atlas.mode === 'generated' ? 'AI research atlas' : 'Curated demonstration'}</strong><small>{atlas.parts.length} documented systems</small></span>
          </div>
        </aside>

        <section className="foundry-stage">
          <div className="foundry-stage-head">
            <span>{stageState}</span>
            <span>{String(visibleParts.length).padStart(2, '0')} VISIBLE / {String(atlas.parts.length).padStart(2, '0')} TOTAL</span>
          </div>
          <div className="foundry-stage-grid" aria-hidden="true" />
          <div
            className={`foundry-assembly${hasIllustratedExplosion ? ' rich-assembled' : ''}`}
            style={{
              opacity: hasIllustratedExplosion ? Math.max(0, 1 - explode * 2.35) : Math.max(0.12, 1 - explode * 0.9),
              transform: `translate(-50%, -50%) scale(${1 - explode * (hasIllustratedExplosion ? 0.06 : 0.16)})`,
            }}
          >
            {atlas.image ? <img src={atlas.image} alt={atlas.imageAlt ?? `Assembled ${atlas.subject}`} /> : <ElectricVehicleVisual />}
            <span className="assembly-axis axis-x" /><span className="assembly-axis axis-y" />
          </div>
          {hasIllustratedExplosion && (
            <div
              className="foundry-exploded-visual"
              style={{
                opacity: Math.max(0, Math.min(1, (explode - 0.12) * 2.8)),
                transform: `translate(-50%, -50%) scale(${0.96 + explode * 0.04})`,
              }}
            >
              <img src={atlas.explodedImage} alt={atlas.explodedImageAlt ?? `Conceptual exploded view of ${atlas.subject}`} />
              <span className="foundry-art-badge">AI-ILLUSTRATED · DOCUMENTED SYSTEMS · NOT SERVICE GEOMETRY</span>
              <div className="foundry-hotspots" aria-label="Clickable component regions">
                {visibleParts.map((part) => {
                  const position = atlas.hotspots?.[part.id];
                  if (!position) return null;
                  const partIndex = atlas.parts.findIndex((candidate) => candidate.id === part.id);
                  const active = part.id === selectedPart?.id;
                  return (
                    <button
                      type="button"
                      key={part.id}
                      className={`foundry-hotspot${active ? ' active' : ''}`}
                      style={{ left: `${position.x}%`, top: `${position.y}%`, '--part-color': part.color } as CSSProperties}
                      disabled={explode < 0.36}
                      onClick={() => setSelectedId(part.id)}
                      aria-label={`Select ${part.name}`}
                      aria-pressed={active}
                    >
                      <i>{String(partIndex + 1).padStart(2, '0')}</i>
                      <span>{part.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!hasIllustratedExplosion && <div className="foundry-parts" aria-label="Clickable component inventory">
            {visibleParts.map((part, index) => {
              const target = targetPosition(index, visibleParts.length, compact);
              const left = 50 + (target.x - 50) * explode;
              const top = 50 + (target.y - 50) * explode;
              const active = part.id === selectedPart?.id;
              return (
                <button
                  type="button"
                  key={part.id}
                  className={`foundry-part-node${active ? ' active' : ''}`}
                  style={{ left: `${left}%`, top: `${top}%`, opacity: Math.min(1, Math.max(0, (explode - 0.08) * 2.5)), '--part-color': part.color } as CSSProperties}
                  disabled={explode < 0.12}
                  onClick={() => setSelectedId(part.id)}
                >
                  <i>{String(index + 1).padStart(2, '0')}</i>
                  <span><strong>{part.name}</strong><small>{part.system}</small></span>
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
              <div className="foundry-citations">
                <span>SUPPORTING SOURCES</span>
                {selectedSources.length ? selectedSources.map((source) => (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                    <span><strong>{source.title}</strong><small>{source.publisher}</small></span><ExternalLink />
                  </a>
                )) : <p>See the full source register below.</p>}
              </div>
            </>
          ) : <p>Select a component to inspect its record.</p>}
          <div className="foundry-accuracy"><CircleAlert /><p><strong>Know what this is.</strong>{atlas.accuracyNote}</p></div>
        </aside>
      </section>

      <section className="foundry-footnotes">
        <div><span className="foundry-section-number">03 / RESEARCH NOTE</span><p>{atlas.summary}</p></div>
        <div className="source-register"><span className="foundry-section-number">SOURCE REGISTER</span>{atlas.sources.slice(0, 4).map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><i>{String(index + 1).padStart(2, '0')}</i><span>{source.publisher}</span><ExternalLink /></a>)}</div>
        <div className="foundry-boundary"><BookOpen /><p><strong>Conceptual by default.</strong> Generated atlases explain documented major components. They do not infer hidden geometry. When an authoritative mesh dataset exists, use a verified 3D edition—like the human atlas.</p></div>
      </section>
    </main>
  );
}
