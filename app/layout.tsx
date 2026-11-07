import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const lemon = localFont({
  src: [
    { path: "./fonts/lemonmilk-regular.woff", weight: "400", style: "normal" },
    { path: "./fonts/lemonmilk-medium.woff", weight: "500", style: "normal" },
    { path: "./fonts/lemonmilk-bold.woff", weight: "700", style: "normal" },
  ],
  variable: "--font-lemon",
  display: "swap",
});
const poppins = Poppins({ subsets: ["latin", "devanagari"], weight: ["300", "400", "500", "600", "700"], variable: "--font-poppins" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "हिsaab · invoices that prove themselves",
  description: "Bill clients in USDT on Whitechain. They pay without gas. Anyone verifies it from a QR.",
};

export const viewport: Viewport = { themeColor: "#07080a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lemon.variable} ${poppins.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
