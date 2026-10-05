import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer, type MemberRole } from "@/lib/auth";
import { normalizeCard, normalizeColumn } from "@/lib/board-state";
import { createClient } from "@/lib/supabase/server";
import { BoardView } from "./board-view";

export const metadata: Metadata = { title: "Quadro" };

export default async function BoardPage({ params }: PageProps<"/quadros/[id]">) {
  const viewer = await requireViewer("/painel");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: board } = await supabase.from("boards").select("id, name, workspace_id, workspaces(name)").eq("id", id).maybeSingle();
  if (!board) notFound(); // RLS: quadro de outro espaço também resulta em "não encontrado"

  const [columns, cards, labels, members] = await Promise.all([
    supabase.from("columns").select("id, board_id, name, position").eq("board_id", id),
    supabase.from("cards").select("id, board_id, column_id, title, description, position, due_on, assignee_id, version, updated_at, card_labels(label_id)").eq("board_id", id),
    supabase.from("labels").select("id, name, color").eq("workspace_id", board.workspace_id).order("name"),
    supabase.from("members").select("user_id, role, profiles(full_name)").eq("workspace_id", board.workspace_id),
  ]);
  const myRole = (members.data ?? []).find((m) => m.user_id === viewer.id)?.role as MemberRole;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Trilha" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/painel" className="underline">Meus espaços</Link>
        <span aria-hidden="true">/</span>
        <span>{(board.workspaces as unknown as { name: string }).name}</span>
        <span aria-hidden="true">/</span>
        <Link href={`/quadros/${id}/atividade`} className="ml-auto underline">Histórico de atividades</Link>
      </nav>
      <BoardView
        boardId={id}
        boardName={board.name}
        workspaceId={board.workspace_id}
        viewer={{ id: viewer.id, name: viewer.fullName, role: myRole }}
        initial={{
          columns: (columns.data ?? []).map((c) => normalizeColumn(c)),
          cards: (cards.data ?? []).map((c) => ({
            ...normalizeCard(c),
            label_ids: (c.card_labels as { label_id: string }[]).map((l) => l.label_id),
          })),
        }}
        labels={labels.data ?? []}
        members={(members.data ?? []).map((m) => ({ id: m.user_id, name: (m.profiles as unknown as { full_name: string }).full_name }))}
      />
    </div>
  );
}
