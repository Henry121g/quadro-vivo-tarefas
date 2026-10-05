import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Pagination, parsePage } from "@/components/pagination";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Histórico de atividades" };

const PAGE_SIZE = 40;

function describe(action: string, d: Record<string, string>): string {
  switch (action) {
    case "cartao_criado":
      return `criou o cartão “${d.titulo}”`;
    case "cartao_editado":
      return `editou o cartão “${d.titulo}”`;
    case "cartao_movido":
      return `moveu “${d.titulo}” de ${d.de} para ${d.para}`;
    case "cartao_excluido":
      return `excluiu o cartão “${d.titulo}”`;
    case "comentario":
      return `comentou em “${d.titulo}”`;
    case "coluna_criada":
      return `criou a coluna “${d.nome}”`;
    default:
      return action;
  }
}

export default async function ActivityPage({ params, searchParams }: PageProps<"/quadros/[id]/atividade">) {
  await requireViewer("/painel");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const page = parsePage(sp.pagina);
  const supabase = await createClient();
  const { data: board } = await supabase.from("boards").select("id, name").eq("id", id).maybeSingle();
  if (!board) notFound();
  const { data, count } = await supabase
    .from("activity")
    .select("id, action, details, created_at, profiles(full_name)", { count: "exact" })
    .eq("board_id", id)
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Link href={`/quadros/${id}`} className="text-sm underline">← Voltar ao quadro</Link>
      <h1 className="text-2xl font-bold">Histórico — {board.name}</h1>
      {data?.length ? (
        <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface text-sm">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 p-3">
              <span>
                <strong>{(a.profiles as unknown as { full_name: string } | null)?.full_name ?? "Sistema"}</strong>{" "}
                {describe(a.action, a.details as Record<string, string>)}
              </span>
              <time dateTime={a.created_at} className="text-muted">
                {new Date(a.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="Nenhuma atividade ainda." />
      )}
      <Pagination basePath={`/quadros/${id}/atividade`} params={{}} page={page} pageSize={PAGE_SIZE} total={count ?? 0} />
    </div>
  );
}
