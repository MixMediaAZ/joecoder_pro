import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground h-full overflow-hidden">
        {children}
      </body>
    </html>
  );
}
