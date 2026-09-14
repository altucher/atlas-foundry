# Atlas Foundry

Atlas Foundry turns a subject into a sourced, clickable component atlas. Enter an object such as “espresso machine,” “Tesla,” or “data center”; the server researches reliable public sources, builds a deep component catalog, generates matched photorealistic assembled and exploded views, and maps the documented parts into a clickable visual index.

**Live demo:** [build-an-interactive-3d-human-atlas.vercel.app](https://build-an-interactive-3d-human-atlas.vercel.app)

## Use this repo to make “exploding X”

Point a coding agent at this repository and ask:

> Use this repository to build an exploding atlas for **[X]**. Preserve its sourcing, fidelity labels, clickable parts, responsive non-overlapping layout, and attribution rules. Use authoritative 3D meshes when they exist; otherwise make a clearly labeled conceptual 2.5D atlas and do not invent hidden geometry.

The agent-specific adaptation contract is in [`AGENTS.md`](AGENTS.md). It explains the fidelity decision, source requirements, extension points, validation steps, and definition of done.

The project also preserves **Corpus**, the authoritative BodyParts3D adult male explorer, at `/human`. It contains 2,234 source meshes and must be distinguished from generated atlases: generic subjects are conceptual 2.5D learning maps, not inferred 3D geometry, service manuals, or engineering drawings.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Add a server-side `OPENAI_API_KEY` to `.env.local` to enable direct OpenAI generation locally, or use an `AI_GATEWAY_API_KEY` for Vercel AI Gateway. Credentials are used only by `app/api/generate-atlas/route.ts` and are never sent to the browser. Without a credential, the curated Tesla systems demo and full human atlas remain usable.

Generated atlases are saved to the shared gallery when the deployment has a Vercel Blob store linked. Set `ATLAS_CACHE_ORIGIN` on a secondary deployment to the canonical Vercel URL to make it use the same authenticated generator and gallery without copying an OpenAI credential.

Production checks:

```bash
npm run check
npm run validate:atlas
npm run validate:interactions
npm run build
```

`npm run build` produces the Sites/Cloudflare Worker bundle. Vercel reads `vercel.json` and runs `next build --webpack` against the same App Router source. On Vercel, the API route automatically uses the deployment's private `VERCEL_OIDC_TOKEN` with AI Gateway, so no project-level secret needs to be copied. A team-level OpenAI BYOK credential, when configured in AI Gateway, remains private and is applied there.

## Product modes

- **Generated atlas:** web research with cited first-party or authoritative sources, 12–24 records for simple objects or 36–60 records for complex products and infrastructure, a high-quality photorealistic assembled/exploded image pair, independently animated visual component layers, full-component click regions, system and vendor filters, component and connection search, continuous explosion control, and a dedicated component-by-component supplier/IP evidence pass. Public companies receive Yahoo Finance links.
- **Curated demo:** a ready-to-show cross-generation Tesla electric-vehicle systems overview with paired assembled/exploded studio illustrations and twelve clickable component regions. Supplier notes identify the generation, model year, trim, market, or plant supported by each source. It is explicitly conceptual; the hotspots are a visual index, not service geometry.
- **Verified 3D edition:** the `/human` route uses identity-preserving BodyParts3D source meshes, GPU per-part transforms, geometric picking, and true visible-only exploded packing.

Generated imagery is a visual navigation aid. It does not reveal hidden geometry, and component cards should not be interpreted as spatially exact callouts. Potentially dangerous teardown instructions are excluded by the research prompt.

## File structure

```text
app/
  page.tsx                    Generic Atlas Foundry workbench
  foundry-data.ts             Shared schema and curated Tesla demo
  api/generate-atlas/route.ts Server-side web research and image generation
  api/gallery/route.ts        Shared cached-atlas/gallery API
  atlas-store.ts              Stable cache keys and Vercel Blob persistence
  human/page.tsx              Full BodyParts3D interface
  anatomy.ts                  Human system taxonomy and catalog types
  scene.tsx                   Three.js batching, picking, and camera controls
  explosion-layout.ts         Human visible-mesh exploded packing
  globals.css                 Foundry and human dark-studio visual systems
components/ui/                shadcn-style controls
public/models/atlas.json      BodyParts3D identity-preserving manifest
public/ATTRIBUTION.md         Anatomy data license and adaptation details
```

## Live data pipeline

`POST /api/generate-atlas` accepts `{ "prompt": "…" }` and performs two server-side operations:

1. The OpenAI Responses API first distinguishes a named product from a generic category, researches the public web, and returns a strict component-atlas schema with up to 60 components and 40 supporting HTTPS sources. Complex products retain documented second-, third-, and readable fourth-level assemblies instead of being reduced to a short exterior overview. Generic subjects such as “data center” become vendor-neutral reference architectures spanning the full operating chain rather than a fictional single installation.
2. After the inventory exists, a separate supplier-research pass divides the full parts list into small parallel batches and gives every component an explicit audit record. It searches for current, former, alternative, generation-specific, factory-specific, regional, and credibly rumored relationships instead of spending the whole search budget on headline chips. It distinguishes manufacturer, assembler, designer, IP licensor, software provider, material supplier, and integrator roles—for example, display panel/module/backlight/driver roles and battery cell/pack/BMS roles remain separate, and a chip designer is not treated as its foundry or packaging/test provider.
3. Every retained relationship is visibly classified as **confirmed**, **reported**, or **rumored**, includes a directly clickable claim-specific source and a generation/model-year/trim/market/plant applicability note when available. Components with no retained relationship still say whether a component-specific search was completed, genuinely inapplicable, or incomplete—absence is never silently presented as proof of no supplier. For a generic category, supplier records are explicitly described as representative alternatives for that component class—not evidence that every vendor appears in one deployment. Public companies receive a server-derived Yahoo Finance URL; private suppliers are clearly labeled. A general brand supplier list alone is not accepted as proof that a company makes a particular component.
4. The Images API renders matched high-quality assembled and exhaustive exploded studio views in parallel with the supplier batches, using portrait plates for strongly vertical subjects such as launch vehicles.

### Multilevel data-center archive

The generic data-center atlas can be deepened in six independent research passes after its facility-to-chip overview exists: Site & building, Electrical chain, Thermal & water, Rack to silicon, Network/optics/storage, and Controls/safety/operations. Each layer adds 24–36 lower-level sourced records and its own component-by-component supplier audit, then merges by stable component identity into one canonical archive. The UI opens the overview image first and exposes each deeper layer as a separately packed, clickable inventory so hundreds of records do not overlap in one unreadable plate.

The prompts `data center`, `a data center`, `the data center`, and `data centers` all resolve to the same `data-center` gallery key. Maintainers can extend that record with an authenticated production request carrying `X-Atlas-Deep-Build: 1`; this preserves completed layers and images while merging the new research.
5. A vision pass locates each researched part in the exploded image and attaches its source-backed record to a clickable hotspot. If visual generation or localization fails, the researched catalog still returns with a deterministic non-overlapping inventory fallback.
6. Direct power, data, thermal, fluid, mechanical, structural, and control relationships connect the returned component IDs. Selecting a component draws its connection map over the exploded plate and exposes navigable relationship cards in the detail panel.
7. The completed atlas and its image pair are stored under a normalized subject key in Vercel Blob. A repeated prompt is served from the shared gallery before any research or image generation runs.

The browser requests an NDJSON progress stream. Submission immediately scrolls to the workbench, where a quiet build journal reports cache lookup, research, the actual named sources returned by the research pass, component inventory size, both image renders, hotspot mapping, and the gallery save. These are operational milestones—not hidden model reasoning.

The generation route requests an extended Fluid-compute window. The large architecture pass uses GPT-5.6 Terra with low reasoning by default: this preserves detailed web-grounded structured output while fitting 36–60-component catalogs inside synchronous gateway limits. The smaller component-supplier batches use GPT-6 Astra for deeper forensic research. Responses are submitted in background mode and polled when the provider supports that lifecycle; if a transient upstream disconnect still occurs, the route automatically retries once with GPT-5.6 Terra or Luna and a bounded source window. The supplier batches and two high-quality renders run concurrently before visual localization. The deployment plan must support the configured duration; completed subjects subsequently load from the shared gallery.

The UI packs only the currently visible records, interpolating them from the assembled center into a responsive desktop or two-column mobile inventory. Search and system filters recompute the layout, so filtered parts do not leave gaps or overlap.

The gallery is shared by all visitors to the canonical deployment. It is a cache of generated educational artifacts, not an assertion that all changing supplier relationships remain current forever; source and applicability notes remain visible on every saved record.
Saved atlases carry an intelligence-schema version. Opening an older gallery item triggers one transparent research refresh so newly added supplier/IP fields are populated; the refreshed atlas then overwrites the same stable subject key and resumes instant loading.

## BodyParts3D data pipeline

The human ingestion boundary is `public/models/atlas.json`. It points to version-pinned browser-ready chunks and preserves each BodyParts3D element ID, official name, FMA-style concept ID, display system, typed-array offsets, source bounds, and assembled transform.

To rebuild from the official release:

1. Download the BodyParts3D 4.0 OBJ archive and English concept/element relationship tables.
2. Join source elements to official names and FMA concepts, keeping the curated display-system map separate.
3. Run `python3 scripts/convert-anatomy.py OBJ_DIRECTORY CONCEPT_MAP SYSTEM_MAP`.
4. Run `node scripts/optimize-anatomy.mjs` and `node scripts/compress-models.mjs`.
5. Run both validation scripts before publishing.

## License and attribution

Original application code is released under the [MIT License](LICENSE). Dataset files, generated assets, and third-party adaptations retain their own licenses and attribution requirements.

BodyParts3D, © The Database Center for Life Science, is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- [BodyParts3D downloads](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html)
- [Dataset license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
- [Source publication](https://doi.org/10.1093/nar/gkn613)
- [Full local adaptation notes](public/ATTRIBUTION.md)

Prepared browser assets and portions of the human rendering/data-pipeline implementation are adapted from the MIT-licensed [ashemag/human-atlas](https://github.com/ashemag/human-atlas). Its license is preserved in `THIRD_PARTY_LICENSE.md`.

## Disclaimer

Atlas Foundry is educational. Generated atlases are not engineering, repair, safety, legal, or clinical tools. The human edition is not a diagnostic, surgical-planning, or medical-decision tool and represents one adult male reference anatomy rather than individual variation.
