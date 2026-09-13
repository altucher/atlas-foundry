# Atlas Foundry

Atlas Foundry turns a subject into a sourced, clickable component atlas. Enter an object such as “espresso machine” or “DSLR camera”; the server researches reliable public sources, builds a concise component catalog, generates an assembled reference image, and presents the result as a non-overlapping exploded inventory.

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

Production checks:

```bash
npm run check
npm run validate:atlas
npm run validate:interactions
npm run build
```

`npm run build` produces the Sites/Cloudflare Worker bundle. Vercel reads `vercel.json` and runs `next build --webpack` against the same App Router source. On Vercel, the API route automatically uses the deployment's private `VERCEL_OIDC_TOKEN` with AI Gateway, so no project-level secret needs to be copied. A team-level OpenAI BYOK credential, when configured in AI Gateway, remains private and is applied there.

## Product modes

- **Generated atlas:** web research with cited first-party or authoritative sources, 6–14 major component records, an AI-generated assembled reference image, system filters, component search, and explosion control.
- **Curated demo:** a ready-to-show Tesla electric-vehicle systems overview. It is explicitly conceptual and varies by model/year/trim.
- **Verified 3D edition:** the `/human` route uses identity-preserving BodyParts3D source meshes, GPU per-part transforms, geometric picking, and true visible-only exploded packing.

Generated imagery is a visual navigation aid. It does not reveal hidden geometry, and component cards should not be interpreted as spatially exact callouts. Potentially dangerous teardown instructions are excluded by the research prompt.

## File structure

```text
app/
  page.tsx                    Generic Atlas Foundry workbench
  foundry-data.ts             Shared schema and curated Tesla demo
  api/generate-atlas/route.ts Server-side web research and image generation
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

1. The OpenAI Responses API researches the public web and returns a strict component-atlas schema with supporting HTTPS sources.
2. The Images API renders one assembled, unlabeled external reference view. If image generation fails, the researched catalog still returns and remains explorable.

The UI packs only the currently visible records, interpolating them from the assembled center into a responsive desktop or two-column mobile inventory. Search and system filters recompute the layout, so filtered parts do not leave gaps or overlap.

Generated results are transient and are not written to a database. Add persistence or object storage before offering saved public atlas URLs.

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
