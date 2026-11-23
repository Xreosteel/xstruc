"use client";
import { useParams } from "next/navigation";
import { ImportDrawing } from "@/components/local/ImportDrawing";

export default function ImportPage() {
  const { id } = useParams<{ id: string }>();
  return <ImportDrawing pid={id} />;
}
