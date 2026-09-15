'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Focus,
  Info,
  Layers3,
  Menu,
  Pause,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import AnatomyScene from '../scene';
import {
  DEFAULT_VISIBLE,
  SYSTEMS,
  explanation,
  type Atlas,
  type SceneState,
  type SystemId,
  type View,
} from '../anatomy';

type Panel = 'systems' | 'search' | 'about' | null;
type SearchResult = {
  key: string;
  id: string;
  name: string;
  elements: string[];
  system?: SystemId;
  kind: 'concept' | 'mesh';
};

const ORGANS: SystemId[] = [
  'cardiac',
  'respiratory',
  'digestive',
  'urinary',
  'endocrine',
  'reproductive',
  'sensory',
];

const INITIAL_STATE: SceneState = {
  explode: 0,
  visible: DEFAULT_VISIBLE,
  selected: [],
  isolate: false,
  view: 'three-quarter',
  rotate: false,
  reset: 0,
};

const views: { id: View; short: string; label: string }[] = [
  { id: 'three-quarter', short: '¾', label: 'Three-quarter view' },
  { id: 'front', short: 'F', label: 'Front view' },
  { id: 'side', short: 'S', label: 'Side view' },
  { id: 'back', short: 'B', label: 'Back view' },
];

export default function Home() {
  const searchInput = useRef<HTMLInputElement>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [state, setState] = useState<SceneState>(INITIAL_STATE);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<{ name: string; id: string } | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'shared'>('idle');

  useEffect(() => {
    const abort = new AbortController();
    fetch('/models/atlas.json', { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error('The anatomy catalog could not be loaded.');
        return response.json();
      })
      .then((data) => setAtlas(data as Atlas))
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        setPanel('search');
        requestAnimationFrame(() => searchInput.current?.focus());
      }
      if (event.key === 'Escape') {
        setPanel(null);
        setShareMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedExplosion = Number(params.get('explode'));
    const requestedView = params.get('view') as View | null;
    const requestedVisible = params.get('visible')?.split(',').filter((id): id is SystemId => SYSTEMS.some((system) => system.id === id));
    setState((current) => ({
      ...current,
      explode: Number.isFinite(requestedExplosion) ? Math.max(0, Math.min(1, requestedExplosion / 100)) : current.explode,
      visible: requestedVisible?.length ? requestedVisible : current.visible,
      isolate: params.get('isolate') === '1',
      view: requestedView && views.some((view) => view.id === requestedView) ? requestedView : current.view,
      rotate: false,
    }));
  }, []);

  useEffect(() => {
    if (!atlas) return;
    const selection = new URLSearchParams(window.location.search).get('selection');
    if (!selection) return;
    const concept = atlas.concepts.find((candidate) => candidate.id === selection);
    const part = atlas.parts.find((candidate) => candidate.id === selection);
    if (concept) {
      setSelectedLabel({ name: concept.name, id: concept.id });
      setState((current) => ({ ...current, selected: concept.elements }));
    } else if (part) {
      setSelectedLabel({ name: part.name, id: part.conceptId || part.id });
      setState((current) => ({ ...current, selected: [part.id] }));
    }
  }, [atlas]);

  const partsById = useMemo(() => new Map(atlas?.parts.map((part) => [part.id, part])), [atlas]);
  const activeSystems = useMemo(
    () =>
      SYSTEMS.map((system) => ({
        ...system,
        count: atlas?.parts.filter((part) => part.system === system.id).length ?? 0,
      })).filter((system) => system.count > 0),
    [atlas],
  );

  const selectedParts = state.selected.map((id) => partsById.get(id)).filter((part) => part !== undefined);
  const selectedPart = selectedParts[0];
  const selectedSystem = SYSTEMS.find((system) => system.id === selectedPart?.system);
  const visibleCount =
    atlas?.parts.filter((part) =>
      state.isolate ? state.selected.includes(part.id) : state.visible.includes(part.system) || state.selected.includes(part.id),
    ).length ?? 0;

  const results = useMemo<SearchResult[]>(() => {
    if (!atlas) return [];
    const term = query.trim().toLowerCase();
    const suggestions = new Set(['heart', 'brain', 'liver', 'stomach', 'femur', 'trachea']);
    const concepts = atlas.concepts
      .filter((concept) =>
        term
          ? concept.name.toLowerCase().includes(term) || concept.id.toLowerCase().includes(term)
          : suggestions.has(concept.name.toLowerCase()),
      )
      .map<SearchResult>((concept) => ({
        key: `concept-${concept.id}`,
        id: concept.id,
        name: concept.name,
        elements: concept.elements,
        kind: 'concept',
      }));
    const meshes = term
      ? atlas.parts
          .filter((part) => part.name.toLowerCase().includes(term) || part.id.toLowerCase().includes(term))
          .map<SearchResult>((part) => ({
            key: `mesh-${part.id}`,
            id: part.id,
            name: part.name,
            elements: [part.id],
            system: part.system,
            kind: 'mesh',
          }))
      : [];
    return [...concepts, ...meshes]
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(term)) - Number(a.name.toLowerCase().startsWith(term)) || a.name.length - b.name.length)
      .slice(0, 60);
  }, [atlas, query]);

  const selectResult = (result: SearchResult) => {
    setSelectedLabel({ name: result.name, id: result.id });
    setState((current) => ({
      ...current,
      selected: result.elements,
      isolate: false,
      rotate: false,
    }));
    setPanel(null);
  };

  const selectPart = (id: string) => {
    const part = partsById.get(id);
    if (!part) return;
    setSelectedLabel({ name: part.name, id: part.conceptId || part.id });
    setState((current) => ({ ...current, selected: [id], isolate: false, rotate: false }));
    setPanel(null);
  };

  const setPreset = (systems: SystemId[]) => {
    setSelectedLabel(null);
    setState((current) => ({ ...current, visible: systems, selected: [], isolate: false }));
  };

  const toggleSystem = (id: SystemId) => {
    setState((current) => ({
      ...current,
      selected: [],
      isolate: false,
      visible: current.visible.includes(id) ? current.visible.filter((system) => system !== id) : [...current.visible, id],
    }));
    setSelectedLabel(null);
  };

  const reset = () => {
    setState((current) => ({ ...INITIAL_STATE, reset: current.reset + 1 }));
    setSelectedLabel(null);
    setPanel(null);
    setQuery('');
  };

  const shareAnatomy = async (method: 'copy' | 'native') => {
    const url = new URL('/human', window.location.origin);
    url.searchParams.set('explode', String(Math.round(state.explode * 100)));
    url.searchParams.set('visible', state.visible.join(','));
    url.searchParams.set('view', state.view);
    if (state.isolate) url.searchParams.set('isolate', '1');
    if (selectedLabel?.id ?? selectedPart?.id) url.searchParams.set('selection', selectedLabel?.id ?? selectedPart?.id ?? '');
    try {
      if (method === 'native' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Adult male anatomy — Explode Anything', text: 'Explore this interactive anatomy explosion.', url: url.toString() });
        setShareStatus('shared');
      } else {
        await navigator.clipboard.writeText(url.toString());
        setShareStatus('copied');
      }
      setShareMenuOpen(false);
      window.setTimeout(() => setShareStatus('idle'), 2200);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      window.prompt('Copy this anatomy link', url.toString());
    }
  };

  const selectedDescription = selectedPart
    ? explanation(selectedLabel?.name ?? selectedPart.name, selectedPart.system)
    : '';

  return (
    <main className="atlas-shell">
      {atlas && (
        <AnatomyScene
          atlas={atlas}
          state={{ ...state, inspectorOpen: Boolean(selectedPart) }}
          onSelect={selectPart}
          onProgress={setProgress}
          onError={setError}
        />
      )}
      <div className="studio-overlay" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="brand-block">
        <div className="brand-kicker"><span /> ANATOMICAL INDEX / BP3D 4.0</div>
        <div className="brand-title-row">
          <h1>Corpus</h1>
          <Badge variant="outline">MALE 01</Badge>
        </div>
        <p>{atlas?.parts.length.toLocaleString() ?? '2,234'} preserved source meshes</p>
      </header>

      <nav className="utility-nav" aria-label="Atlas utilities">
        <Button variant="outline" onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="Search structures">
          <Search /> <span>Search atlas</span> <kbd>/</kbd>
        </Button>
        <div className="anatomy-share-control">
          <Button variant="outline" onClick={() => setShareMenuOpen((open) => !open)} aria-label="Share anatomy explosion" aria-haspopup="menu" aria-expanded={shareMenuOpen}>
            {shareStatus === 'idle' ? <Share2 /> : <Check />} <span>{shareStatus === 'shared' ? 'Shared' : shareStatus === 'copied' ? 'Copied' : 'Share'}</span>
          </Button>
          {shareMenuOpen && (
            <div className="anatomy-share-menu" role="menu" aria-label="Share options">
              <button type="button" role="menuitem" onClick={() => void shareAnatomy('copy')}><Copy /><span>Copy link</span></button>
              <button type="button" role="menuitem" onClick={() => void shareAnatomy('native')}><Send /><span>Share via…</span></button>
            </div>
          )}
        </div>
        <Button variant="outline" size="icon" onClick={() => setPanel(panel === 'about' ? null : 'about')} aria-label="About this atlas">
          <Info />
        </Button>
      </nav>

      <aside className={`systems-panel glass-panel ${panel === 'systems' ? 'mobile-visible' : ''}`} aria-label="Anatomical systems">
        <div className="panel-title-row">
          <div>
            <span className="micro-label">01 / LAYERS</span>
            <h2>Systems</h2>
          </div>
          <Button variant="ghost" size="icon" className="mobile-only" onClick={() => setPanel(null)} aria-label="Close systems">
            <X />
          </Button>
        </div>
        <div className="preset-row" aria-label="Layer presets">
          <Button variant="ghost" aria-pressed={state.visible.length === activeSystems.length} onClick={() => setPreset(activeSystems.map((system) => system.id))}>All</Button>
          <Button variant="ghost" aria-pressed={state.visible.length === 1 && state.visible[0] === 'skeletal'} onClick={() => setPreset(['skeletal'])}>Skeleton</Button>
          <Button variant="ghost" aria-pressed={ORGANS.every((id) => state.visible.includes(id)) && state.visible.length === ORGANS.length} onClick={() => setPreset(ORGANS)}>Organs</Button>
        </div>
        <div className="system-list">
          {activeSystems.map((system) => (
            <div className={`system-item ${state.visible.includes(system.id) ? 'is-on' : ''}`} key={system.id}>
              <Button variant="ghost" onClick={() => setPreset([system.id])} title={`Show only ${system.name}`}>
                <i style={{ '--system-color': system.color } as CSSProperties} />
                <span>{system.name}</span>
                <small>{system.count}</small>
              </Button>
              <Switch checked={state.visible.includes(system.id)} onCheckedChange={() => toggleSystem(system.id)} aria-label={`Toggle ${system.name}`} />
            </div>
          ))}
        </div>
        <div className="panel-count"><span>{visibleCount.toLocaleString()} pieces staged</span><Button variant="ghost" onClick={() => setPreset([])}>Hide all</Button></div>
      </aside>

      {panel === 'search' && (
        <section className="search-panel glass-panel" aria-label="Search atlas">
          <div className="panel-title-row compact">
            <div><span className="micro-label">02 / INDEX</span><h2>Find structure</h2></div>
            <Button variant="ghost" size="icon" onClick={() => setPanel(null)} aria-label="Close search"><X /></Button>
          </div>
          <div className="search-field"><Search /><Input ref={searchInput} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, FMA or mesh ID" /></div>
          <div className="search-results" role="listbox">
            {results.map((result) => (
              <Button variant="ghost" role="option" key={result.key} onClick={() => selectResult(result)}>
                <span><strong>{result.name}</strong><small>{result.kind === 'mesh' ? 'Source mesh' : `${result.elements.length} ${result.elements.length === 1 ? 'mesh' : 'meshes'}`}</small></span>
                <code>{result.id}</code><ChevronRight />
              </Button>
            ))}
            {!results.length && <p>No exact structure found. Try a broader anatomical term.</p>}
          </div>
          <p className="search-hint">Searches common/official names, FMA concepts, and source mesh identifiers.</p>
        </section>
      )}

      {panel === 'about' && (
        <section className="about-panel glass-panel" aria-label="About this atlas">
          <div className="panel-title-row compact">
            <div><span className="micro-label">SOURCE / SCOPE</span><h2>Anatomy, documented.</h2></div>
            <Button variant="ghost" size="icon" onClick={() => setPanel(null)} aria-label="Close about"><X /></Button>
          </div>
          <p>This atlas presents the BodyParts3D 4.0 adult male reference as 2,234 individually selectable source meshes and 3,432 named concepts.</p>
          <p>Geometry is web-optimized while preserving mesh identity. Colors and display layers are curated for exploration and do not replace the source ontology.</p>
          <div className="about-stats"><span><strong>2.29M</strong> triangles</span><span><strong>15</strong> systems</span><span><strong>CC BY 4.0</strong> anatomy</span></div>
          <p className="medical-note"><CircleHelp /> Educational reference only. Not a diagnostic, surgical, or clinical tool.</p>
          <div className="source-links"><a href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">BodyParts3D source ↗</a><a href="/ATTRIBUTION.md" target="_blank" rel="noreferrer">Attribution & adaptations ↗</a></div>
        </section>
      )}

      <nav className="view-rail glass-panel" aria-label="Camera views">
        {views.map((view) => (
          <Button
            key={view.id}
            variant="ghost"
            aria-label={view.label}
            aria-pressed={state.view === view.id}
            disabled={state.explode > 0.8 && view.id !== 'front'}
            onClick={() => setState((current) => ({ ...current, view: view.id, rotate: false, reset: current.reset + 1 }))}
          >{view.short}</Button>
        ))}
        <div className="rail-rule" />
        <Button variant="ghost" aria-label={state.rotate ? 'Pause rotation' : 'Auto rotate'} disabled={state.explode > 0.35} aria-pressed={state.rotate} onClick={() => setState((current) => ({ ...current, rotate: !current.rotate }))}>{state.rotate ? <Pause /> : <RotateCw />}</Button>
        <Button variant="ghost" aria-label="Reset atlas" onClick={reset}><RotateCcw /></Button>
      </nav>

      <div className="specimen-label" aria-live="polite">
        <span />
        {state.isolate ? selectedLabel?.name : state.explode > 0.94 ? 'VISIBLE-PART INVENTORY' : state.explode > 0.05 ? 'SEPARATED ANATOMY' : 'ASSEMBLED REFERENCE'}
        <span />
      </div>

      <section className="control-dock glass-panel" aria-label="Exploded view controls">
        <Button variant="ghost" className="systems-trigger mobile-only" onClick={() => setPanel(panel === 'systems' ? null : 'systems')}><Menu /><span>Layers</span></Button>
        <div className="explode-control">
          <div className="explode-copy"><span><Sparkles /> Exploded view</span><output>{Math.round(state.explode * 100)}<small>%</small></output></div>
          <Slider
            aria-label="Explosion amount"
            min={0}
            max={100}
            step={1}
            value={[state.explode * 100]}
            onValueChange={(value) => {
              const next = (Array.isArray(value) ? value[0] : value) / 100;
              setState((current) => ({ ...current, explode: next, view: next > 0.8 ? 'front' : current.view, rotate: false }));
            }}
          />
          <div className="explode-scale"><span>Assembled</span><span>Inventory</span></div>
        </div>
        <Button variant="ghost" className="dock-reset" onClick={reset}><RotateCcw /><span>Reset</span></Button>
      </section>

      {selectedPart && (
        <aside className="detail-panel glass-panel" aria-label="Selected structure details">
          <div className="detail-system"><i style={{ background: selectedSystem?.color }} /><span>{selectedSystem?.name ?? 'Anatomy'}</span><Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => { setSelectedLabel(null); setState((current) => ({ ...current, selected: [], isolate: false })); }}><X /></Button></div>
          <h2>{selectedLabel?.name ?? selectedPart.name}</h2>
          <p>{selectedDescription}</p>
          <div className="detail-meta"><span>Source ID<strong>{selectedLabel?.id ?? selectedPart.id}</strong></span><span>Selected<strong>{selectedParts.length} {selectedParts.length === 1 ? 'mesh' : 'meshes'}</strong></span></div>
          {selectedParts.length > 1 && <p className="group-note">This named concept contains {selectedParts.length} preserved source meshes.</p>}
          <Button className="isolate-button" onClick={() => setState((current) => ({ ...current, isolate: !current.isolate, explode: current.isolate ? current.explode : 0, rotate: false }))}><Focus />{state.isolate ? 'Return to context' : 'Isolate structure'}<ChevronRight /></Button>
          <small className="disclaimer">Educational reference — not a clinical tool.</small>
        </aside>
      )}

      <footer className="interaction-help">
        <span><Box /> {state.explode > 0.8 ? 'Drag to pan' : 'Drag to orbit'} · Scroll/pinch to zoom · Tap to inspect</span>
        <button onClick={() => setPanel('about')}>Data + credits</button>
      </footer>

      {(!atlas || progress < 100) && !error && (
        <div className="loading-card glass-panel" role="status">
          <div className="loading-orbit"><i /><i /><i /></div>
          <div><strong>Assembling source anatomy</strong><span>{progress}% · {atlas ? `${atlas.parts.length.toLocaleString()} meshes` : 'Reading catalog'}</span><div><i style={{ width: `${progress}%` }} /></div></div>
        </div>
      )}
      {error && <div className="error-card glass-panel" role="alert"><strong>Viewer unavailable</strong><p>{error}</p><Button onClick={() => window.location.reload()}>Reload atlas</Button></div>}
    </main>
  );
}
