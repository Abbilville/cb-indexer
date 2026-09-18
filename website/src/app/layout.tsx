import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'cb-indexer — Microservice Architecture & Ingestion Hub',
  description:
    'Control plane & 2D/3D AST knowledge graph topology dashboard for microservices and multi-repo architectures.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#090d16] text-[#f3f4f6]">
        {children}
      </body>
    </html>
  );
}
