"use client";
import { useParams } from "next/navigation";
import { LocalWorkbench } from "@/components/local/LocalWorkbench";

export default function JobElement() {
  const { id, el } = useParams<{ id: string; el: string }>();
  return <LocalWorkbench key={id + "/" + el} pid={id} eid={el} />;
}
