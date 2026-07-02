import type { Metadata } from "next";
import { Inter, Crimson_Pro, Cinzel } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const crimson = Crimson_Pro({
  subsets: ["latin"],
  variable: "--font-crimson",
  display: "swap",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Plum Tabletop — D&D with Codex DM",
  description:
    "Self-hosted D&D 5e VTT with Codex (GPT-5) as autonomous Dungeon Master.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${crimson.variable} ${cinzel.variable}`}
    >
      <body className="font-sans antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
