import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPC Optimizer",
  description: "Turn Amazon Ads reports into bid changes, negative keywords and harvest keywords.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Extensions such as Grammarly and password managers add attributes to
    // <body> before React hydrates. That is outside our control and harmless,
    // but React reports the mismatch as an error, so this element opts out of
    // the check. It is scoped to <body> only — real mismatches inside the app
    // are still reported.
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
