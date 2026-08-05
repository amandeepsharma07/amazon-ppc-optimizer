import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPC Optimizer",
  description: "Turn Amazon Ads reports into bid changes, negative keywords and harvest keywords.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
