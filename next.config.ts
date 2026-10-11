import type { NextConfig } from "next";

// Framing: only /embed may be framed, and only by the TAO-1 and jtao origins (plus any in ATLAS_EMBED_ORIGINS at build time, e.g. their preview hosts).
// Every other page refuses to be framed.
const embedParents = ['https://tao1.ai', 'https://www.tao1.ai', 'https://jtao.ai', 'https://www.jtao.ai',
  ...(process.env.ATLAS_EMBED_ORIGINS ?? '').split(/[\s,]+/).filter((origin) => /^https:\/\/[a-z0-9.-]+$/i.test(origin))];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/embed', headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${embedParents.join(' ')}` }] },
      { source: '/((?!embed).*)', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }, { key: 'X-Frame-Options', value: 'DENY' }] },
    ];
  },
};

export default nextConfig;
