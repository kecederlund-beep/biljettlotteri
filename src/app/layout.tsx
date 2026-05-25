import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Luleå Hockey - Biljettlotteri",
  description: "Biljettlotteri för medlemmar i Luleå Hockey"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
