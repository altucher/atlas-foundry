# Explode Anything: build cost baseline (ESTIMATE, 2026-10-11)

Status: an estimate from the call structure and OpenAI list prices. Live builds are blocked today (OpenAI 402, no credits), so there are no measured numbers yet.
Replace this with measured numbers: after OpenAI is topped up, run one build on a preview with the cost ledger on (buildCost in the saved atlas, "atlas_cost" log line).

## Prices used (OpenAI list, https://developers.openai.com/api/docs/pricing, read 2026-10-11)
| model | input $/1M | cached $/1M | output $/1M |
|---|---|---|---|
| gpt-5.4-mini (draft research, image QA) | 0.75 | 0.075 | 4.50 |
| gpt-5.6-luna (hotspots) | 0.20 | 0.02 | 1.20 |
| gpt-5.6-terra (deep layers) | 2.00 | 0.20 | 12.00 |
| gpt-6-astra (supplier research) | 10.00 | 1.00 | 50.00 |
| web search tool | 10 per 1,000 calls | | |
| gpt-image-2.5-flare | text 5.00 | | image output 30.00 (per-image price not published; ESTIMATE 0.19 for a 1536x1024 high image, about 6.2k output tokens) |

## Call structure of one build (route.ts)
- Draft phase: 1 research call (gpt-5.4-mini, low effort, web search low), 2 image generations (assembled + exploded) each followed by 1-2 image QA calls (gpt-5.4-mini, image input), retries on QA failure or a 5xx.
- Enrich phase: one supplier-research call per 6 components (gpt-6-astra, web search medium), then 1 hotspot-mapping call (gpt-5.6-luna, image input).

## Assumed tokens per call (ASSUMPTIONS, not measured)
- draft research: 40k input (search content), 15k output; 6 searches
- image QA: 2.5 calls x (2.5k input, 0.6k output)
- supplier batch: 60k input, 8k output, 10 searches
- hotspots: 3.5k input, 60 output tokens per part

## Result (941 saved atlases: parts mean 21.4, median 19, max 237)
| build | draft | enrich | total |
|---|---|---|---|
| 20 parts | $0.55 | $4.40 | $4.95 |
| 40 parts | $0.55 | $7.70 | $8.25 |
| 60 parts | $0.55 | $11.01 | $11.55 |
| mean of the 941 saved atlases | $0.55 | $4.34 | $4.89 |

Re-building every saved atlas once would be about $4,600 at these assumptions. About 90% of a build is the supplier pass on gpt-6-astra, so the supplier pass is where Phase B saves money (images are about $0.4 and stay on OpenAI).
Sensitivity: tokens per call could be half or double; the per-image price could be 0.1 to 0.3. Expect the real total within about 2x of the figures above.
