import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/ui";
import { canManage, requireViewer, ROLE_LABEL, type MemberRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewBoardForm } from "./forms";

export const metadata: Metadata = { title: "Meus espaços" };

export default async function DashboardPage({ searchParams }: PageProps<"/painel">) {
  const viewer = await requireViewer("/painel");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("role, workspaces(id, name, boards(id, name, created_at))")
    .eq("user_id", viewer.id)
    .order("created_at");
  const spaces = (data ?? []).map((m) => ({
    role: m.role as MemberRole,
    ws: m.workspaces as unknown as { id: string; name: string; boards: { id: string; name: string; created_at: string }[] },
  }));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">Meus espaços</h1>
      {sp.convite === "aceito" && <Alert kind="success">Convite aceito! O espaço já aparece abaixo.</Alert>}
      {sp.saiu && <Alert kind="success">Você saiu do espaço.</Alert>}
      {error && <Alert kind="error">Não foi possível carregar seus espaços. Atualize a página.</Alert>}
      {spaces.length === 0 && !error && <EmptyState title="Você ainda não participa de nenhum espaço." />}
      {spaces.map(({ role, ws }) => (
        <section key={ws.id} aria-labelledby={`ws-${ws.id}`} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`ws-${ws.id}`} className="text-lg font-semibold">
              {ws.name} <span className="text-sm font-normal text-muted">· {ROLE_LABEL[role]}</span>
            </h2>
            <Link href={`/espacos/${ws.id}`} className="text-sm font-semibold text-brand underline">
              Membros e convites <span className="sr-only">de {ws.name}</span>
            </Link>
          </header>
          {ws.boards.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...ws.boards].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((b) => (
                <li key={b.id}>
                  <Link href={`/quadros/${b.id}`} className="block rounded-lg border border-border bg-background p-4 font-semibold hover:border-brand">
                    {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhum quadro neste espaço." />
          )}
          {canManage(role) && <NewBoardForm workspaceId={ws.id} />}
        </section>
      ))}
    </div>
  );
}
