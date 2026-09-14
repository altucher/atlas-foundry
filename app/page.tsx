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
  const hasIllustratedExplosion = Boolean(atlas.explodedImage);
  const showingEveryPart = visibleParts.length === atlas.parts.length;

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
    setNotice('Researching primary sources, then rendering a matched photorealistic assembled and exploded pair…');
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
      setNotice(payload.imageWarning ? `Research complete. ${payload.imageWarning}` : 'Research and photorealistic exploded views complete. Select any numbered component to inspect it.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The atlas could not be generated.');
    } finally {
      setGenerating(false);
    }
  }

  const stageState = explode < 0.08 ? 'ASSEMBLED OBJECT' : explode > 0.88 ? (hasIllustratedExplosion ? 'EXPLODED SYSTEMS' : 'COMPONENT INVENTORY') : 'SEPARATING SYSTEMS';
  const stageInstruction = hasIllustratedExplosion && explode >= 0.22 ? `${stageState} · CLICK A PART` : stageState;

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
            <span>{stageInstruction}</span>
            <span>{String(visibleParts.length).padStart(2, '0')} VISIBLE / {String(atlas.parts.length).padStart(2, '0')} TOTAL</span>
          </div>
          <div className="foundry-stage-grid" aria-hidden="true" />
          <div
            className={`foundry-assembly${hasIllustratedExplosion ? ' rich-assembled' : ''}`}
            style={{
              opacity: hasIllustratedExplosion ? Math.max(0, 1 - explode * 1.45) : Math.max(0.12, 1 - explode * 0.9),
              transform: `translate(-50%, -50%) scale(${1 - explode * (hasIllustratedExplosion ? 0.06 : 0.16)})`,
            }}
          >
            {atlas.image ? <img src={atlas.image} alt={atlas.imageAlt ?? `Assembled ${atlas.subject}`} /> : <div className="foundry-visual-fallback"><Box /><span>ASSEMBLED IMAGE UNAVAILABLE</span></div>}
            <span className="assembly-axis axis-x" /><span className="assembly-axis axis-y" />
          </div>
          {hasIllustratedExplosion && (
            <div
              className="foundry-exploded-visual"
              style={{
                transform: `translate(-50%, -50%) scale(${0.97 + explode * 0.03})`,
              }}
            >
              <img
                className="foundry-exploded-base"
                src={atlas.explodedImage}
                alt={atlas.explodedImageAlt ?? `Conceptual exploded view of ${atlas.subject}`}
                style={{ opacity: showingEveryPart ? Math.max(0, Math.min(1, (explode - 0.82) / 0.18)) : 0 }}
              />
              <div className="foundry-part-layers" aria-hidden="true">
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
                    const shiftX = (50 - region.x) * (1 - explode);
                    const shiftY = (46 - region.y) * (1 - explode);
                    return (
                      <div
                        key={`${part.id}-layer-${regionIndex}`}
                        className={`foundry-part-layer${active ? ' active' : ''}`}
                        style={{
                          clipPath: `inset(${top}% ${right}% ${bottom}% ${left}% round 4%)`,
                          opacity: Math.max(0, Math.min(1, (explode - 0.03) * 1.85)),
                          transform: `translate(${shiftX}%, ${shiftY}%) scale(${0.48 + explode * 0.52})`,
                          transformOrigin: `${region.x}% ${region.y}%`,
                        }}
                      >
                        <img src={atlas.explodedImage} alt="" />
                      </div>
                    );
                  });
                })}
              </div>
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
                        left: `${50 + (region.x - 50) * explode}%`,
                        top: `${46 + (region.y - 46) * explode}%`,
                        width: `${(region.width ?? 9) * (0.48 + explode * 0.52)}%`,
                        height: `${(region.height ?? 9) * (0.48 + explode * 0.52)}%`,
                        '--part-color': part.color,
                      } as CSSProperties}
                      disabled={explode < 0.12}
                      onClick={() => setSelectedId(part.id)}
                      aria-label={`Select ${part.name}`}
                      aria-pressed={active}
                    >
                      <i>{String(partIndex + 1).padStart(2, '0')}</i>
                      <span>{part.name}</span>
                    </button>
                  ));
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
