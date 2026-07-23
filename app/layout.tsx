import type { Metadata, Viewport } from "next";
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
