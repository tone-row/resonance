import type { Metadata } from "next";
import { Libertinus_Serif_Display, Reddit_Sans } from "next/font/google";
import "./globals.css";

const fontSansCustom = Reddit_Sans({
  variable: "--font-sans-custom",
  subsets: ["latin"],
  weight: ["400"],
});

const fontSerifCustom = Libertinus_Serif_Display({
  variable: "--font-serif-custom",
  subsets: ["latin"],
  weight: ["400"],
  fallback: ["serif"],
});

export const metadata: Metadata = {
  title: "Resonance",
  description: "A collaborative decision-making tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontSansCustom.variable} ${fontSerifCustom.variable} antialiased bg-background text-foreground`}
    >
      <body>{children}</body>
    </html>
  );
}
