import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Hisaab · invoices that prove themselves",
  description: "Bill clients in USDT on Whitechain. They pay without gas. Anyone verifies it from a QR.",
};

export const viewport: Viewport = { themeColor: "#f6f1e6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="grain">{children}</body>
    </html>
  );
}
