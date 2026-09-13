# Atlas Foundry adaptation guide

This repository is meant to be adapted into an “exploding X” experience, where X can be a documented object, organism, machine, work of architecture, instrument, or other multipart subject.

## Start here

When a user asks you to use this repository to create an exploding atlas for a new subject:

1. Preserve the React, TypeScript, vinext/Vite, Three.js, and shadcn-style architecture unless the request requires a different stack.
2. Classify the requested atlas as either:
   - **verified 3D**: authoritative meshes and metadata are available and their identity/license can be preserved; or
   - **conceptual 2.5D**: research supports a component catalog, but exact separated geometry is unavailable.
3. State the chosen fidelity honestly in the interface and README. Never describe AI-generated imagery or inferred internals as exact geometry.
4. Research authoritative sources first: manufacturer manuals, standards, museums, universities, government agencies, source datasets, and peer-reviewed references.
5. Preserve every source URL and identifier used by the component records. Do not invent part names, hidden internals, dimensions, or identifiers.
6. Keep all visible pieces clickable and ensure the fully exploded layout is non-overlapping on desktop and mobile.
7. Add subject-specific safety, medical, legal, or service disclaimers where appropriate. Do not turn an educational atlas into hazardous teardown instructions.
8. Run the complete validation sequence before handing off or publishing.

## Main extension points

- `app/foundry-data.ts`: shared atlas types and curated demonstrations.
- `app/api/generate-atlas/route.ts`: live web research, structured catalog generation, image generation, validation, and rate limiting.
- `app/page.tsx`: generic prompt-to-atlas interface and responsive exploded-card packing.
- `app/human/page.tsx`: example of a verified 3D edition.
- `app/scene.tsx`: batched Three.js rendering, picking, camera framing, and per-part transforms.
- `app/explosion-layout.ts`: visible-only non-overlapping packing for true mesh data.
- `public/models/atlas.json`: example identity-preserving mesh manifest boundary.

## Adding a curated conceptual subject

Create a `FoundryAtlas` record containing:

- a precise subject and scope;
- a short accuracy boundary;
- 6–14 meaningful major components;
- stable internal component IDs;
- system/category assignments and accessible colors;
- concise educational descriptions;
- confidence labels;
- direct HTTPS sources for each component.

Add it as a prompt-matched preset in `app/page.tsx`. Use a code-native SVG for a deterministic assembled illustration or add a properly licensed raster asset under `public/`. Clearly label illustrative visuals.

## Adding a verified 3D subject

Do not convert a single photograph into alleged engineering geometry. Obtain a legitimate OBJ, glTF, or equivalent source set and its metadata/license. Preserve source-part identity in the manifest even if geometry is merged into GPU-friendly batches at runtime. Each part needs:

- source ID and official name;
- system/category;
- assembled transform and bounds;
- typed-array or glTF offsets;
- source attribution and license;
- picking identity after batching.

Compute explosion targets only for visible pieces. Validate projected bounds against overlap at representative desktop and phone aspect ratios.

## Required checks

```bash
npm ci
npm run check
npm run validate:interactions
npm run validate:atlas   # required when the BodyParts3D edition is retained
npm run build
```

Live generation additionally requires a server-side `OPENAI_API_KEY`. Never commit credentials or expose them through a `NEXT_PUBLIC_` variable. Add durable rate limiting and result storage before opening expensive generation to high-volume public traffic.

## Definition of done

- The assembled subject is immediately legible.
- Explosion is smooth and every visible record has a dedicated non-overlapping target.
- Click/tap selection and drag gestures do not conflict.
- Search, system filters, details, citations, and reset work on desktop and mobile.
- The UI distinguishes sourced facts, contextual interpretations, and illustrative imagery.
- Attribution and relevant disclaimers ship with the result.
