import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
// KaTeX's stylesheet. Without it the math plugin still runs but every formula
// renders as unstyled spans, which looks worse than the raw LaTeX did.
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://liberde.ai"),
  title: "Liberde",
  description: "Your self-hosted, model-agnostic AI platform.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Liberde", statusBarStyle: "default" },
  // Link previews when app routes (/login, /share/…, /a/…) are pasted around.
  openGraph: {
    type: "website",
    siteName: "Liberde",
    title: "Liberde — One Experience, Every Model",
    description:
      "One polished AI experience where Claude, GPT, Kimi, Qwen, Mistral, Llama, and other models work together. Your models, your data, your AI.",
    url: "https://liberde.ai/",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "An abstract bird breaking free of a circuit-covered box — freedom from model lock-in.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Liberde — One Experience, Every Model",
    description:
      "One polished AI experience where Claude, GPT, Kimi, Qwen, Mistral, Llama, and other models work together.",
    images: ["/og.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Required for env(safe-area-inset-*) to report anything: without it iOS
  // letterboxes the page inside the safe area and every inset reads 0, so the
  // composer padding that keeps it clear of the home indicator would be inert.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#262624" },
  ],
};

// Resolve the saved theme preference and stamp data-theme on <html> before the
// first paint, so there's no light/dark flash on load. "system" resolves to the
// OS preference; an explicit choice wins.
const themeInit = `(function(){try{var p=localStorage.getItem('liberde-theme')||'system';var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Standalone mode on iOS/Android home-screen launch (belt-and-suspenders
            alongside Next's appleWebApp metadata). */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="antialiased">
        {children}
        {/* Vercel Web Analytics — page views / visitors. No-op off Vercel. */}
        <Analytics />
      </body>
    </html>
  );
}
