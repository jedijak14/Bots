import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { BRAND } from "@/lib/brand";
import { THEME_SCRIPT } from "@/components/ThemeSync";
import "./globals.css";

/**
 * Absolute URLs for social images. Vercel exposes its own origin at build time;
 * APP_ORIGIN covers self-hosting and custom domains.
 */
const metadataBase = (() => {
  const explicit = process.env.APP_ORIGIN?.trim();
  if (explicit) return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
  if (process.env.VERCEL_URL) return new URL(`https://${process.env.VERCEL_URL}`);
  return new URL("http://localhost:3000");
})();

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: ["AI bots", "AI companions", "agents", "chat", "bring your own key"],
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    siteName: BRAND.name,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
  },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so the saved theme is on the document
            immediately; without it a light-mode visitor sees a black flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
