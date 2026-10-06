import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonStyles } from "@/components/button-styles";
import { canManage, requireViewer, ROLE_LABEL, type MemberRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { changeRole, removeMember, revokeInvite } from "@/app/painel/actions";
import { InviteForm } from "@/app/painel/forms";

export const metadata: Metadata = { title: "Membros e convites" };

export default async function WorkspacePage({ params }: PageProps<"/espacos/[id]">) {
  const viewer = await requireViewer("/painel");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: ws }, { data: members }, { data: invites }] = await Promise.all([
    supabase.from("workspaces").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("members").select("user_id, role, profiles(full_name)").eq("workspace_id", id).order("created_at"),
    supabase.from("invites").select("id, email, role, expires_at").eq("workspace_id", id).is("accepted_at", null).order("created_at"),
  ]);
  if (!ws) notFound();
  const myRole = members?.find((m) => m.user_id === viewer.id)?.role as MemberRole | undefined;
  const isOwner = myRole === "dono";
  const manage = canManage(myRole);
  const select = "min-h-11 rounded-lg border border-border bg-surface px-2";

  return (
    <div className="flex flex-col gap-8">
      <Link href="/painel" className="text-sm underline">← Meus espaços</Link>
      <h1 className="text-2xl font-bold">{ws.name}</h1>

      <section aria-labelledby="membros" className="flex flex-col gap-3">
        <h2 id="membros" className="text-lg font-semibold">Membros</h2>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {(members ?? []).map((m) => {
            const name = (m.profiles as unknown as { full_name: string }).full_name;
            const role = m.role as MemberRole;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <span>
                  {name} {m.user_id === viewer.id && <span className="text-muted">(você)</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {isOwner && role !== "dono" ? (
                    <form action={changeRole} className="flex items-center gap-2">
                      <input type="hidden" name="workspaceId" value={id} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <label className="sr-only" htmlFor={`papel-${m.user_id}`}>Papel de {name}</label>
                      <select id={`papel-${m.user_id}`} name="role" defaultValue={role} className={select}>
                        <option value="admin">Administrador</option>
                        <option value="membro">Membro</option>
                        <option value="leitor">Leitor</option>
                      </select>
                      <button className={buttonStyles.secondary}>Salvar <span className="sr-only">papel de {name}</span></button>
                    </form>
                  ) : (
                    <span className="text-muted">{ROLE_LABEL[role]}</span>
                  )}
                  {role !== "dono" && (manage || m.user_id === viewer.id) && (
                    <form action={removeMember}>
                      <input type="hidden" name="workspaceId" value={id} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <button className={buttonStyles.danger}>
                        {m.user_id === viewer.id ? "Sair do espaço" : <>Remover <span className="sr-only">{name}</span></>}
                      </button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {manage && (
        <section aria-labelledby="convites" className="flex flex-col gap-3">
          <h2 id="convites" className="text-lg font-semibold">Convidar</h2>
          <p className="text-sm text-muted">A pessoa precisa ter uma conta com o mesmo e-mail (ela pode criar depois de receber o link).</p>
          <div className="rounded-xl border border-border bg-surface p-4">
            <InviteForm workspaceId={id} isOwner={isOwner} />
          </div>
          {invites && invites.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface text-sm">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    {i.email} · {ROLE_LABEL[i.role as MemberRole]} · expira em {new Date(i.expires_at).toLocaleDateString("pt-BR")}
                  </span>
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="workspaceId" value={id} />
                    <button className={buttonStyles.danger}>Revogar <span className="sr-only">convite de {i.email}</span></button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
