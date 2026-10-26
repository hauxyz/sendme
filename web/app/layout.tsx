import type { Metadata } from "next";
import { Toaster } from "sonner";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SendMe — Self-hosted email infrastructure",
    template: "%s — SendMe",
  },
  description:
    "Send transactional email and campaigns with direct Go delivery or your own SMTP relays. Multi-domain, self-hosted, and built for developers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#18181b",
              border: "1px solid #2e2e33",
              color: "#fafafa",
            },
          }}
        />
      </body>
    </html>
  );
}
