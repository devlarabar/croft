import type { ReactNode } from "react";
import { Document } from "../document";
import "./utilities.css";

interface RootLayoutProps {
  children: ReactNode;
}

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: RootLayoutProps) {
  return <Document>{children}</Document>;
}
