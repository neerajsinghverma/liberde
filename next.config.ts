import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@modelcontextprotocol/sdk", "pdf-parse"],
};

// Vercel BotID: invisible bot detection for protected routes (see /api/auth).
export default withBotId(nextConfig);
