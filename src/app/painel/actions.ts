"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  success?: string;
  inviteLink?: string;
}

export async function createBoard(_: FormState, formData: FormData): Promise<FormState> {
  await requireViewer("/painel");
  const parsed = z
    .object({ workspaceId: z.uuid(), name: z.string().trim().min(2, "Nome muito curto.").max(80) })
    .safeParse({ workspaceId: formData.get("workspaceId"), name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .insert({ workspace_id: parsed.data.workspaceId, name: parsed.data.name })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };
  // Colunas iniciais (RLS: quem cria quadro também pode criar colunas).
  await supabase.from("columns").insert(
    ["A fazer", "Fazendo", "Feito"].map((name, i) => ({ workspace_id: parsed.data.workspaceId, board_id: data.id, name, position: (i + 1) * 1024 })),
  );
  revalidatePath("/painel");
  redirect(`/quadros/${data.id}`);
}

export async function createInvite(_: FormState, formData: FormData): Promise<FormState> {
  await requireViewer("/painel");
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      email: z.email("Informe um e-mail válido."),
      role: z.enum(["admin", "membro", "leitor"]),
    })
    .safeParse({ workspaceId: formData.get("workspaceId"), email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invite", {
    p_ws: parsed.data.workspaceId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/espacos/${parsed.data.workspaceId}`);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return {
    success: `Convite criado para ${parsed.data.email}. Envie o link abaixo (válido por 7 dias; o envio automático por e-mail está pendente de configuração do Resend).`,
    inviteLink: `${base}/convite/${token}`,
  };
}

export async function revokeInvite(formData: FormData) {
  await requireViewer("/painel");
  const p = z.object({ id: z.uuid(), workspaceId: z.uuid() }).safeParse({ id: formData.get("id"), workspaceId: formData.get("workspaceId") });
  if (!p.success) return;
  const supabase = await createClient();
  await supabase.from("invites").delete().eq("id", p.data.id);
  revalidatePath(`/espacos/${p.data.workspaceId}`);
}

export async function changeRole(formData: FormData) {
  await requireViewer("/painel");
  const p = z
    .object({ workspaceId: z.uuid(), userId: z.uuid(), role: z.enum(["admin", "membro", "leitor"]) })
    .safeParse({ workspaceId: formData.get("workspaceId"), userId: formData.get("userId"), role: formData.get("role") });
  if (!p.success) return;
  const supabase = await createClient();
  await supabase.from("members").update({ role: p.data.role }).eq("workspace_id", p.data.workspaceId).eq("user_id", p.data.userId);
  revalidatePath(`/espacos/${p.data.workspaceId}`);
}

export async function removeMember(formData: FormData) {
  const viewer = await requireViewer("/painel");
  const p = z.object({ workspaceId: z.uuid(), userId: z.uuid() }).safeParse({ workspaceId: formData.get("workspaceId"), userId: formData.get("userId") });
  if (!p.success) return;
  const supabase = await createClient();
  await supabase.from("members").delete().eq("workspace_id", p.data.workspaceId).eq("user_id", p.data.userId);
  if (p.data.userId === viewer.id) redirect("/painel?saiu=1");
  revalidatePath(`/espacos/${p.data.workspaceId}`);
}

export async function acceptInvite(_: FormState, formData: FormData): Promise<FormState> {
  await requireViewer("/painel");
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "Link de convite inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/painel");
  redirect("/painel?convite=aceito");
}
