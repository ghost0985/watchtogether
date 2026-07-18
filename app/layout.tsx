import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "WatchTogether",
  description: "Watch YouTube in perfect sync — a private two-person watch party.",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg font-sans text-text">
        {/* Phone layout is untouched (this cap is wider than any phone
            viewport already is) — this only changes things on a laptop/
            desktop screen, where the app now uses real webpage-width space
            instead of floating as a narrow phone-shaped column. */}
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
