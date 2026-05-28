import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QAi — Steel Detailing QA",
  description: "AI-powered steel detailing quality assurance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}