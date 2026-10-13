// The LoRA exploded view is rendered in its own follow-up step IN PARALLEL with the supplier pass, and either step can save last. The supplier pass's final save used to look only at the draft record for an
// exploded view (r19+LoRA witness 10-13: Garmin and Anker had exploded.jpg in the store but atlas.json without explodedImage / hotspots, so a person saw no exploded view). Take it from whichever record has one.
export type ExplodedFields = { explodedImage?: string; explodedImageAlt?: string; hotspots?: unknown };

/** the exploded fields to carry into the final save: none when the draft already has one; else from the gallery record, else from the draft record (the freshest place the exploded step wrote to) */
export function pickExploded(draft: ExplodedFields | null | undefined, latestGallery: ExplodedFields | null | undefined, latestDraft: ExplodedFields | null | undefined): ExplodedFields {
  if (draft?.explodedImage) return {};
  for (const source of [latestGallery, latestDraft]) {
    if (source?.explodedImage) return { explodedImage: source.explodedImage, explodedImageAlt: source.explodedImageAlt, hotspots: source.hotspots };
  }
  return {};
}
