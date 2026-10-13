// ATLAS_OPEN_ONLY=1 (founder 10-12: Explode uses open-weight models only). In this mode the atlas pipeline only runs with its open-weight providers: research, supplier audit, image QA and hotspots
// through the TAO-1 gateway, images through Chutes. Any configuration that would send a call to OpenAI, the Vercel AI gateway or OpenRouter (Gemini) is refused (fail closed) instead of silently falling back.

export function openOnlyOn(env: Record<string, string | undefined> = process.env) {
  return env.ATLAS_OPEN_ONLY?.trim() === '1';
}

/** what is wrong with the environment for an open-weight-only run (empty list = fine). overrides are the admin request overrides (x-atlas-text-provider / x-atlas-image-provider). */
export function openOnlyViolations(env: Record<string, string | undefined>, overrides: { text?: string; image?: string } = {}): string[] {
  const problems: string[] = [];
  const lower = (value: string | undefined) => value?.trim().toLowerCase();
  if (!env.TAO1_API_KEY?.trim()) problems.push('TAO1_API_KEY is not set (research, supplier audit, image QA and hotspots run on the TAO-1 gateway)');
  if ((overrides.text ?? lower(env.ATLAS_TEXT_PROVIDER)) !== 'tao1') problems.push('the text provider is not tao1 (it would fall back to OpenAI)');
  if (lower(env.ATLAS_VISION_PROVIDER) !== 'tao1') problems.push('the vision provider is not tao1 (it would fall back to OpenAI)');
  if (!env.CHUTES_API_KEY?.trim()) problems.push('CHUTES_API_KEY is not set (images run on Chutes)');
  if ((overrides.image ?? lower(env.ATLAS_IMAGE_PROVIDER)) !== 'chutes') problems.push('the image provider is not chutes (it would fall back to OpenAI images)');
  const exploded = lower(env.ATLAS_EXPLODED_PROVIDER);
  if (exploded === 'openrouter') problems.push('ATLAS_EXPLODED_PROVIDER=openrouter (Gemini) is closed-weight');
  return problems;
}
