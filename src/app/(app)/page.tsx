import type { Metadata } from "next";
import { Gallery } from "@/components/Gallery";

export const metadata: Metadata = { title: { absolute: "Bots — your AI companions" } };

export default function HomePage() {
  return <Gallery />;
}
