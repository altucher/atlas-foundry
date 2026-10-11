# Explode Anything embed contract (v1, 2026-10-11)

Show an atlas inside the TAO-1 chat with an iframe.

## URL
`https://explodeanything.com/embed?atlas=<key>[&theme=light|dark]` opens a saved atlas (key from the gallery, e.g. `falcon-9`, `espresso-machine`; `tesla` is the curated Tesla demo).
`https://explodeanything.com/embed?q=<topic>[&t=<token>]` opens the saved atlas for the topic if there is one, otherwise builds it in the visitor's browser and saves it in the shared store.
`t` is reserved for the TAO-1 metering token (sent to the server as the X-Explode-Token header); it is not validated yet.
The page shows only the viewer: exploded image, slider, numbered parts, part panel with suppliers and sources, and a small "Open full atlas ↗" link. Works from about 380 to 760 px wide.
`theme=light` is a best-effort inversion of the dark design; dark is the default.

## Framing
`/embed` sends `Content-Security-Policy: frame-ancestors https://tao1.ai https://www.tao1.ai https://jtao.ai https://www.jtao.ai` (plus any hosts in the build env ATLAS_EMBED_ORIGINS, for example preview hosts).
Every other page sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

## Messages to the parent (window.postMessage)
Sent only when the parent origin (from location.ancestorOrigins, or the referrer) is on the same allow-list (extra origins in NEXT_PUBLIC_ATLAS_EMBED_ORIGINS).
Every message is `{ source: 'explode-anything', version: 1, type, ... }`:
| type | when | fields |
|---|---|---|
| `explode:ready` | the atlas (saved or newly built) is on screen | key, subject, parts, stage (`complete` or `draft`) |
| `explode:height` | content height changes (also once at start) | height (px; set the iframe height to this) |
| `explode:build-progress` | a build started by ?q= reports a stage | key (the requested topic), stage, message |
| `explode:done` | a build started in this frame has finished (the first draft is delivered; stage tells whether supplier research is done) | key, subject, parts, stage |
Listen with `window.addEventListener('message', (e) => { if (e.origin !== 'https://explodeanything.com' || e.data?.source !== 'explode-anything') return; ... })`.
The frame sends nothing else and accepts no messages.
