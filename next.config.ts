import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  // @napi-rs/canvas is a native (.node) addon — it must be required at runtime
  // from node_modules, never bundled. pdf-parse stays external for the same
  // reason (it loads pdf.js and a worker by path).
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "pdf-parse",
    "@napi-rs/canvas",
    "mammoth",
  ],
  async headers() {
    return [
      // Applied everywhere: block MIME-sniffing + trim referrer leakage.
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // Anti-clickjacking on the app itself. Excludes /live/* — those are the
      // intentionally-embeddable published-artifact pages (which set their own
      // sandbox CSP); framing them is the whole point.
      {
        source: "/((?!live/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

// Vercel BotID: invisible bot detection for protected routes (see /api/auth).
export default withBotId(nextConfig);
