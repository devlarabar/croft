import type { ReactNode } from "react";
import { Document } from "../document";
import "./utilities.css";

interface RootLayoutProps {
  children: ReactNode;
}

export const dynamic = "force-dynamic";
export const viewport = { width: undefined, initialScale: undefined };

export default function RootLayout({ children }: RootLayoutProps) {
  return <Document>{children}</Document>;
}
