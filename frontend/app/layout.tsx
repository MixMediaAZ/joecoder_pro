import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "JoeCoder Pro 20.1",
  description: "Durable, governed, chat-first autonomous coding agent",
  keywords: ["AI", "coding", "agent", "development"],
  authors: [{ name: "JoeCoder Pro" }],
};

export default function RootLayout({ children }: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground h-full overflow-hidden">
        {children}
      </body>
    </html>
  );
}