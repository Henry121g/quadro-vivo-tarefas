"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { buttonStyles } from "@/components/button-styles";
import { normalizeCard, type Card } from "@/lib/board-state";
import { friendlyDbError, isConflict } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import type { Label, Member } from "./board-view";

interface Comment {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export function CardDialog(props: {
  card: Card;
  workspaceId: string;
  labels: Label[];
  members: Member[];
  viewerId: string;
  editable: boolean;
  onClose: () => void;
  onSaved: (card: Card) => void;
  onDeleted: (id: string) => void;
  onConflict: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const ref = useRef<HTMLDialogElement>(null);
  const { card } = props;
  // Versão que o usuário está vendo ao começar a editar (base para detectar conflito).
  const [baseVersion, setBaseVersion] = useState(card.version);
  const [form, setForm] = useState({
    title: card.title,
    description: card.description ?? "",
    due_on: card.due_on ?? "",
    assignee_id: card.assignee_id ?? "",
    label_ids: card.label_ids ?? [],
  });
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const names = useMemo(() => new Map(props.members.map((m) => [m.id, m.name])), [props.members]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Se outra pessoa alterou o cartão e eu não estou editando, mostro a versão nova
  // (ajuste de estado durante a renderização, padrão recomendado pelo React para estado derivado).
  if (!dirty && card.version !== baseVersion) {
    setBaseVersion(card.version);
    setForm({
      title: card.title,
      description: card.description ?? "",
      due_on: card.due_on ?? "",
      assignee_id: card.assignee_id ?? "",
      label_ids: card.label_ids ?? [],
    });
  }

  useEffect(() => {
    let alive = true;
    supabase
      .from("comments")
      .select("id, author_id, body, created_at")
      .eq("card_id", card.id)
      .order("created_at")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setMessage({ kind: "error", text: "Não foi possível carregar os comentários." });
        else setComments(data);
      });
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { card_id: string; comment: Comment };
      if (d.card_id === card.id) setComments((list) => (list && !list.some((c) => c.id === d.comment.id) ? [...list, d.comment] : list));
    };
    window.addEventListener("quadro:comentario", onRemote);
    return () => {
      alive = false;
      window.removeEventListener("quadro:comentario", onRemote);
    };
  }, [supabase, card.id]);

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setMessage({ kind: "error", text: "O título não pode ficar vazio." });
    setSaving(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("update_card", {
      p_card: card.id,
      p_fields: {
        title: form.title.trim().slice(0, 200),
        description: form.description.slice(0, 5000),
        due_on: form.due_on || null,
        assignee_id: form.assignee_id || null,
        label_ids: form.label_ids,
      },
      p_expected_version: baseVersion,
    });
    setSaving(false);
    if (error) {
      setMessage({ kind: "error", text: friendlyDbError(error) });
      if (isConflict(error)) {
        setDirty(false); // libera para carregar a versão atual
        await props.onConflict();
      }
      return;
    }
    const saved = { ...normalizeCard(data), label_ids: form.label_ids };
    setBaseVersion(saved.version);
    setDirty(false);
    props.onSaved(saved);
    setMessage({ kind: "success", text: "Cartão salvo." });
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) return;
    const { data, error } = await supabase
      .from("comments")
      .insert({ workspace_id: props.workspaceId, card_id: card.id, author_id: props.viewerId, body: body.slice(0, 2000) })
      .select("id, author_id, body, created_at")
      .single();
    if (error) return setMessage({ kind: "error", text: friendlyDbError(error) });
    setComments((list) => (list && !list.some((c) => c.id === data.id) ? [...list, data] : list));
    setComment("");
  }

  async function remove() {
    if (!window.confirm(`Excluir o cartão “${card.title}”? Não pode ser desfeito.`)) return;
    const { error } = await supabase.from("cards").delete().eq("id", card.id);
    if (error) return setMessage({ kind: "error", text: friendlyDbError(error) });
    props.onDeleted(card.id);
  }

  const input = "min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base disabled:opacity-70";
  const stale = dirty && card.version !== baseVersion;

  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      aria-labelledby="cartao-titulo"
      className="m-auto max-h-[90vh] w-[min(40rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-border bg-surface p-5 text-foreground backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="cartao-titulo" className="text-lg font-semibold">{props.editable ? "Editar cartão" : card.title}</h2>
          <button type="button" className={buttonStyles.secondary} onClick={() => ref.current?.close()}>Fechar</button>
        </div>
        {stale && (
          <Alert kind="error">
            Outra pessoa alterou este cartão enquanto você editava. Ao salvar, você verá a versão dela antes de decidir.
          </Alert>
        )}
        {message && <Alert kind={message.kind}>{message.text}</Alert>}

        <form onSubmit={save} className="flex flex-col gap-3">
          <fieldset disabled={!props.editable} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Título
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} required className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Descrição
              <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={5000} rows={4} className={input} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Prazo
                <input type="date" value={form.due_on} onChange={(e) => set({ due_on: e.target.value })} className={input} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Responsável
                <select value={form.assignee_id} onChange={(e) => set({ assignee_id: e.target.value })} className={input}>
                  <option value="">Ninguém</option>
                  {props.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Etiquetas</legend>
              <div className="flex flex-wrap gap-2">
                {props.labels.map((l) => (
                  <label key={l.id} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={form.label_ids.includes(l.id)}
                      onChange={(e) => set({ label_ids: e.target.checked ? [...form.label_ids, l.id] : form.label_ids.filter((x) => x !== l.id) })}
                    />
                    <span aria-hidden="true" className="size-3 rounded-full" style={{ background: l.color }} />
                    {l.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
          {props.editable && (
            <div className="flex flex-wrap justify-between gap-2">
              <button type="submit" className={buttonStyles.primary} disabled={saving || !dirty}>
                {saving ? "Salvando…" : "Salvar alterações"}
              </button>
              <button type="button" className={buttonStyles.danger} onClick={remove}>Excluir cartão</button>
            </div>
          )}
        </form>

        <section aria-labelledby="comentarios" className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 id="comentarios" className="font-semibold">Comentários</h3>
          {comments === null ? (
            <p className="text-sm text-muted" role="status">Carregando comentários…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted">Nenhum comentário ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-live="polite">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-background p-3 text-sm">
                  <p className="text-xs text-muted">
                    {(c.author_id && names.get(c.author_id)) ?? "Ex-membro"} · {new Date(c.created_at).toLocaleString("pt-BR")}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          {props.editable && (
            <form onSubmit={addComment} className="flex flex-col gap-2">
              <label htmlFor="novo-comentario" className="sr-only">Novo comentário</label>
              <textarea id="novo-comentario" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={2} placeholder="Escreva um comentário…" className={input} />
              <button type="submit" className={`${buttonStyles.secondary} self-start`} disabled={!comment.trim()}>Comentar</button>
            </form>
          )}
        </section>
      </div>
    </dialog>
  );
}
