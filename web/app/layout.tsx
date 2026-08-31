// La coquille de toutes les pages React. Les pages actuelles, elles,
// vivent dans public/ et ne passent pas par ici : elles gardent leur
// propre <head> et leur propre CSS.
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'SASP SUD',
  description: 'Poste de travail de la San Andreas State Police Sud.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#060A12'
};

export default function Racine({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, background: '#060A12', color: '#E8EEF9',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
