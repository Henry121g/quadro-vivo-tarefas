"use client";

import { useActionState, useState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { buttonStyles } from "@/components/button-styles";
import { acceptInvite, createBoard, createInvite } from "./actions";

export function NewBoardForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(createBoard, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Novo quadro" name="name" id={`novo-quadro-${workspaceId}`} required maxLength={80} placeholder="Ex.: Sprint 12" />
        <SubmitButton variant="secondary" pendingLabel="Criando…">Criar quadro</SubmitButton>
      </div>
      {state.error && <Alert kind="error">{state.error}</Alert>}
    </form>
  );
}

export function InviteForm({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const [state, action] = useActionState(createInvite, {});
  const [copied, setCopied] = useState(false);
  const select = "min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-base";
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="E-mail da pessoa" name="email" type="email" required />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Papel
          <select name="role" defaultValue="membro" className={select}>
            {isOwner && <option value="admin">Administrador</option>}
            <option value="membro">Membro</option>
            <option value="leitor">Leitor</option>
          </select>
        </label>
        <SubmitButton pendingLabel="Criando…">Convidar</SubmitButton>
      </div>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && (
        <Alert kind="success">
          <p>{state.success}</p>
          {state.inviteLink && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-surface px-2 py-1 text-xs text-foreground">{state.inviteLink}</code>
              <button
                type="button"
                className={buttonStyles.secondary}
                onClick={async () => {
                  await navigator.clipboard.writeText(state.inviteLink!);
                  setCopied(true);
                }}
              >
                {copied ? "Copiado!" : "Copiar link"}
              </button>
            </div>
          )}
        </Alert>
      )}
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvite, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <SubmitButton pendingLabel="Entrando no espaço…" className="self-start">Aceitar convite</SubmitButton>
    </form>
  );
}
