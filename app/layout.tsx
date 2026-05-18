import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// next/font Geist — self-hosts the woff2 and inlines metric-matched
// fallback so the page renders with the system font at the right cap
// height, then swaps to Geist with zero CLS once the woff2 lands.
//
// - `display: "swap"` is the next/font default, made explicit. We do NOT
//   use `optional` here because the agent's hero ("What deal are you
//   analyzing today?") is the LCP element on the empty state and missing
//   the brand font on first paint hurts perceived quality more than the
//   ~50ms swap risk.
// - `adjustFontFallback: true` is the default for next/font/google and
//   inlines `size-adjust`/`ascent-override` on the fallback so the
//   pre-swap glyph metrics match Geist's. Pinned explicitly so a future
//   "let's turn this off" PR has to surface as a deliberate choice.
// - `preload: true` is the default — keeping the call surface explicit
//   for the same reason.
const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
    display: "swap",
    adjustFontFallback: true,
    preload: true,
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
    display: "swap",
    adjustFontFallback: true,
    preload: true,
});

export const metadata: Metadata = {
    title: "DealWave Agent",
    description:
        "DealWave Agent — research and advisor pipeline for single-family residential deal analysis.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col">
                <TooltipProvider>{children}</TooltipProvider>
            </body>
        </html>
    );
}
