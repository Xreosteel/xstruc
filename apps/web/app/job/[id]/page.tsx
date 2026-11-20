"use client";
import { useParams } from "next/navigation";
import { LocalProject } from "@/components/local/LocalProject";

export default function Job() {
  const { id } = useParams<{ id: string }>();
  return <LocalProject id={id} />;
}
