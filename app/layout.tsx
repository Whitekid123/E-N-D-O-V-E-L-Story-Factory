import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Endovel Story Factory',
  description: 'Serialized novel generation studio',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}