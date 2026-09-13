# Corpus — Interactive 3D Human Atlas

Corpus is a dark-studio anatomy explorer built with React, TypeScript, Vite/vinext, Three.js, and shadcn-style UI components. It opens as an assembled adult male reference body, then separates every visible source mesh into a non-overlapping catalog layout.

The included catalog is the full prepared BodyParts3D 4.0 adult male reference: **2,234 source meshes**, **3,432 named concepts**, and **2,288,268 rendered triangles**. The model is anatomical reference data, not generated anatomy.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by the development server. No API keys are required.

Production checks:

```bash
npm run check
npm run validate:atlas
npm run validate:interactions
npm run build
```

## Features

- Orbit, zoom, pan, and tap/click selection
- 15 system layers with All, Skeleton, and Organs presets
- Animated explosion slider from assembled anatomy to a packed visible-part inventory
- Search by anatomical name, FMA concept ID, or BodyParts3D source mesh ID
- Selection details with system context, official identifier, and educational description
- Isolate and camera-frame selected structures or multi-mesh concepts
- Mobile controls with drag-versus-tap handling and aspect-aware exploded packing
- GPU per-part transforms and merged system geometry for responsive interaction

## File structure

```text
app/
  anatomy.ts             Atlas types, system taxonomy, educational context
  explosion-layout.ts    Visible-only, non-overlapping exploded packing
  model-download.ts      Binary/gzip model decoding and validation
  pointer-tap.ts         Tap-versus-drag and multitouch distinction
  scene.tsx              Three.js renderer, batching, picking, camera framing
  page.tsx               Explorer state and interface
  globals.css            Dark studio visual system and responsive layouts
components/ui/           shadcn-style Button, Badge, Input, Slider, Switch
public/models/
  atlas.json             Identity-preserving mesh/concept manifest and pinned chunk URLs
public/ATTRIBUTION.md     Dataset license, source, and adaptation details
scripts/
  convert-anatomy.py     Official OBJ + metadata ingestion
  optimize-anatomy.mjs   Per-mesh simplification and binary repacking
  compress-models.mjs    Static-host gzip packaging
  validate-atlas.mjs     Buffer, identity, name, and concept checks
  validate-interactions.mjs  Packing, search, and pointer behavior checks
```

## Data pipeline

The ingestion boundary is `public/models/atlas.json`. The included manifest points to version-pinned browser-ready chunks from the public reference repository; the same chunk files can be dropped into `public/models/` and the manifest URLs changed to local paths for fully self-hosted deployments. Each part record preserves:

- BodyParts3D element ID
- official English display name
- FMA-style concept ID
- display system
- binary chunk and typed-array offsets
- vertex/index counts
- assembled-space bounds

To rebuild from the official release:

1. Download the official BodyParts3D 4.0 OBJ archive and the corresponding English concept/element relationship tables.
2. Join source elements to their official names and FMA concepts; maintain a separate curated display-system map.
3. Run `python3 scripts/convert-anatomy.py OBJ_DIRECTORY CONCEPT_MAP SYSTEM_MAP`.
4. Run `node scripts/optimize-anatomy.mjs` and `node scripts/compress-models.mjs`.
5. Run both validation scripts before publishing.

The converter changes coordinate system and units for the browser stage, but does not merge source identities. Optimization is performed per structure; the renderer later merges geometry into system batches while using a per-vertex part index and GPU state textures for translation, visibility, and selection. Picking retains per-part geometry and source bounds.

The exploded layout is computed only from currently visible meshes. Each projected source bound receives a dedicated packed cell, and automated checks exercise desktop and phone aspect ratios for overlap.

## Anatomy license and attribution

BodyParts3D, © The Database Center for Life Science, is licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

- Dataset and downloads: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- Dataset license: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Source publication: Mitsuhashi et al. (2009), *BodyParts3D: 3D structure database for anatomical concepts*, https://doi.org/10.1093/nar/gkn613
- Full adaptation notes: [`public/ATTRIBUTION.md`](public/ATTRIBUTION.md)

The prepared browser assets and portions of the rendering/data-pipeline implementation are adapted from the MIT-licensed [ashemag/human-atlas](https://github.com/ashemag/human-atlas) reference. Its license is preserved in `THIRD_PARTY_LICENSE.md`.

When redistributing the anatomy files or derivatives, retain the BodyParts3D attribution and CC BY 4.0 notice.

## Medical disclaimer

This website is an educational anatomical reference. It is **not** a diagnostic, clinical, surgical-planning, or medical-decision tool. BodyParts3D represents an adult male reference anatomy and does not capture every structure, individual variation, pathology, or demographic.
