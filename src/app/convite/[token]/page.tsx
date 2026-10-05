import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { AcceptInviteForm } from "@/app/painel/forms";

export const metadata: Metadata = { title: "Convite" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const viewer = await requireViewer(`/convite/${token}`);
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">Convite para um espaço</h1>
      <p className="text-muted">
        Você está conectado como <strong>{viewer.email}</strong>. O convite só pode ser aceito pela conta com o e-mail
        convidado.
      </p>
      <AcceptInviteForm token={token} />
    </div>
  );
}
