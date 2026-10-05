"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Alert, buttonStyles } from "@/components/ui";
import { canEdit, type MemberRole } from "@/lib/auth-roles";
import {
  afterForDrop,
  applyEvent,
  cardsOf,
  moveLocally,
  normalizeCard,
  normalizeColumn,
  sortedColumns,
  type BoardEvent,
  type BoardState,
  type Card,
} from "@/lib/board-state";
import { friendlyDbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { CardDialog } from "./card-dialog";
import { MoveDialog } from "./move-dialog";

type Action = BoardEvent | { type: "replace"; state: BoardState };

function reducer(state: BoardState, action: Action): BoardState {
  return action.type === "replace" ? action.state : applyEvent(state, action);
}

export interface Label {
  id: string;
  name: string;
  color: string;
}
export interface Member {
  id: string;
  name: string;
}

type Conn = "conectando" | "online" | "reconectando";

export function BoardView(props: {
  boardId: string;
  boardName: string;
  workspaceId: string;
  viewer: { id: string; name: string; role: MemberRole };
  initial: BoardState;
  labels: Label[];
  members: Member[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [state, dispatch] = useReducer(reducer, props.initial);
  const [conn, setConn] = useState<Conn>("conectando");
  const [online, setOnline] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [dragging, setDragging] = useState<string | null>(null);
  const [newCard, setNewCard] = useState<Record<string, string>>({});
  const disconnected = useRef(false);
  const names = useMemo(() => new Map(props.members.map((m) => [m.id, m.name])), [props.members]);
  const editable = canEdit(props.viewer.role);
  const columns = sortedColumns(state);

  /** Recarrega o quadro inteiro do servidor (após reconexão ou conflito). */
  const refetch = useCallback(async () => {
    const [cols, cards] = await Promise.all([
      supabase.from("columns").select("id, board_id, name, position").eq("board_id", props.boardId),
      supabase
        .from("cards")
        .select("id, board_id, column_id, title, description, position, due_on, assignee_id, version, updated_at, card_labels(label_id)")
        .eq("board_id", props.boardId),
    ]);
    if (cols.error || cards.error) return setError("Não foi possível atualizar o quadro. Tentaremos de novo ao reconectar.");
    dispatch({
      type: "replace",
      state: {
        columns: cols.data.map((c) => normalizeColumn(c)),
        cards: cards.data.map((c) => ({ ...normalizeCard(c), label_ids: (c.card_labels as { label_id: string }[]).map((l) => l.label_id) })),
      },
    });
  }, [supabase, props.boardId]);

  // Canal privado do quadro: eventos do banco + presença.
  useEffect(() => {
    let active = true;
    const channel = supabase.channel(`tarefas:board:${props.boardId}`, {
      config: { private: true, presence: { key: props.viewer.id } },
    });
    const remote = (by: unknown) => typeof by === "string" && by !== props.viewer.id;

    channel
      .on("broadcast", { event: "card_upsert" }, ({ payload }) => {
        const card = normalizeCard(payload.card);
        dispatch({ type: "card_upsert", card });
        if (remote(payload.by)) setAnnounce(`${names.get(payload.by) ?? "Alguém"} atualizou “${card.title}”.`);
      })
      .on("broadcast", { event: "card_deleted" }, ({ payload }) => {
        dispatch({ type: "card_deleted", id: payload.id });
        if (remote(payload.by)) setAnnounce(`${names.get(payload.by) ?? "Alguém"} excluiu um cartão.`);
      })
      .on("broadcast", { event: "card_labels" }, async ({ payload }) => {
        const { data } = await supabase.from("card_labels").select("label_id").eq("card_id", payload.card_id);
        dispatch({ type: "card_labels", card_id: payload.card_id, label_ids: (data ?? []).map((l) => l.label_id) });
      })
      .on("broadcast", { event: "column_upsert" }, ({ payload }) => dispatch({ type: "column_upsert", column: normalizeColumn(payload.column) }))
      .on("broadcast", { event: "column_deleted" }, ({ payload }) => dispatch({ type: "column_deleted", id: payload.id }))
      .on("broadcast", { event: "comment_added" }, ({ payload }) => {
        window.dispatchEvent(new CustomEvent("quadro:comentario", { detail: payload }));
        if (remote(payload.by)) setAnnounce(`${names.get(payload.by) ?? "Alguém"} comentou num cartão.`);
      })
      .on("presence", { event: "sync" }, () => {
        const ids = Object.keys(channel.presenceState());
        setOnline(ids.map((id) => ({ id, name: names.get(id) ?? "Alguém" })));
      });

    (async () => {
      await supabase.realtime.setAuth(); // canal privado: autoriza com o JWT da sessão
      if (!active) return;
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConn("online");
          if (disconnected.current) {
            disconnected.current = false;
            await refetch(); // recupera o que mudou enquanto estávamos desconectados
          }
          await channel.track({ name: props.viewer.name });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (active) {
            disconnected.current = true;
            setConn("reconectando");
          }
        }
      });
    })();

    // Ao voltar para a aba ou para a rede, sincroniza (eventos podem ter sido perdidos).
    const resync = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      active = false;
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
      void supabase.removeChannel(channel);
    };
  }, [supabase, props.boardId, props.viewer.id, props.viewer.name, names, refetch]);

  async function move(cardId: string, columnId: string, afterId: string | null) {
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return;
    setError(null);
    dispatch({ type: "replace", state: moveLocally(state, cardId, columnId, afterId) }); // otimista
    const { data, error: err } = await supabase.rpc("move_card", {
      p_card: cardId,
      p_column: columnId,
      p_after: afterId,
      p_expected_version: card.version,
    });
    if (err) {
      setError(friendlyDbError(err));
      await refetch(); // desfaz o otimista e mostra o estado real
      return;
    }
    dispatch({ type: "card_upsert", card: normalizeCard(data) });
  }

  async function addCard(columnId: string) {
    const title = (newCard[columnId] ?? "").trim();
    if (!title) return;
    const last = cardsOf(state, columnId).at(-1)?.id ?? null;
    const { data, error: err } = await supabase.rpc("create_card", { p_column: columnId, p_title: title.slice(0, 200), p_after: last });
    if (err) return setError(friendlyDbError(err));
    dispatch({ type: "card_upsert", card: { ...normalizeCard(data), label_ids: [] } });
    setNewCard((s) => ({ ...s, [columnId]: "" }));
  }

  async function addColumn(form: HTMLFormElement) {
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    const last = columns.at(-1)?.position ?? 0;
    const { error: err } = await supabase
      .from("columns")
      .insert({ workspace_id: props.workspaceId, board_id: props.boardId, name: name.slice(0, 40), position: last + 1024 });
    if (err) return setError(friendlyDbError(err));
    form.reset();
  }

  async function renameColumn(id: string, current: string) {
    const name = window.prompt("Novo nome da coluna", current)?.trim();
    if (!name || name === current) return;
    const { error: err } = await supabase.from("columns").update({ name: name.slice(0, 40) }).eq("id", id);
    if (err) setError(friendlyDbError(err));
  }

  async function deleteColumn(id: string, name: string, count: number) {
    if (!window.confirm(`Excluir a coluna “${name}”${count ? ` e seus ${count} cartões` : ""}? Não pode ser desfeito.`)) return;
    const { error: err } = await supabase.from("columns").delete().eq("id", id);
    if (err) setError(friendlyDbError(err));
  }

  const openCardData = state.cards.find((c) => c.id === openCard) ?? null;
  const movingCard = state.cards.find((c) => c.id === moving) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{props.boardName}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${conn === "online" ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
            <span aria-hidden="true">{conn === "online" ? "●" : "○"}</span>
            {conn === "online" ? "Ao vivo" : conn === "conectando" ? "Conectando…" : "Reconectando… (alterações serão sincronizadas)"}
          </span>
          <span className="text-muted">
            No quadro agora: {online.length ? online.map((m) => (m.id === props.viewer.id ? "você" : m.name)).join(", ") : "—"}
          </span>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{announce}</p>
      {!editable && <p className="text-sm text-muted">Você é leitor neste espaço: acompanha em tempo real, mas não edita.</p>}
      {error && (
        <div className="flex items-start gap-2">
          <div className="flex-1"><Alert kind="error">{error}</Alert></div>
          <button type="button" className={buttonStyles.secondary} onClick={() => setError(null)}>Fechar aviso</button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4" role="list" aria-label="Colunas do quadro">
        {columns.map((col) => {
          const list = cardsOf(state, col.id);
          return (
            <section
              key={col.id}
              role="listitem"
              aria-labelledby={`col-${col.id}`}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              onDragOver={(e) => editable && dragging && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) void move(dragging, col.id, afterForDrop(state, dragging, col.id, null));
                setDragging(null);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id={`col-${col.id}`} className="font-semibold">
                  {col.name} <span className="text-sm font-normal text-muted">({list.length})</span>
                </h2>
                {editable && (
                  <span className="flex gap-1">
                    <button type="button" className="rounded px-1.5 text-sm text-muted hover:bg-background" onClick={() => renameColumn(col.id, col.name)}>
                      Renomear <span className="sr-only">coluna {col.name}</span>
                    </button>
                    <button type="button" className="rounded px-1.5 text-sm text-danger hover:bg-danger-bg" onClick={() => deleteColumn(col.id, col.name, list.length)}>
                      Excluir <span className="sr-only">coluna {col.name}</span>
                    </button>
                  </span>
                )}
              </div>
              <ul className="flex min-h-12 flex-col gap-2" aria-label={`Cartões em ${col.name}`}>
                {list.map((card) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    labels={props.labels}
                    assignee={card.assignee_id ? names.get(card.assignee_id) : undefined}
                    editable={editable}
                    today={today}
                    dragging={dragging === card.id}
                    onOpen={() => setOpenCard(card.id)}
                    onMove={() => setMoving(card.id)}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(null)}
                    onDropBefore={() => {
                      if (dragging && dragging !== card.id) void move(dragging, col.id, afterForDrop(state, dragging, col.id, card.id));
                      setDragging(null);
                    }}
                  />
                ))}
              </ul>
              {editable && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addCard(col.id);
                  }}
                  className="flex gap-1"
                >
                  <label htmlFor={`novo-${col.id}`} className="sr-only">Novo cartão em {col.name}</label>
                  <input
                    id={`novo-${col.id}`}
                    value={newCard[col.id] ?? ""}
                    onChange={(e) => setNewCard((s) => ({ ...s, [col.id]: e.target.value }))}
                    placeholder="Novo cartão…"
                    maxLength={200}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                  />
                  <button type="submit" className={buttonStyles.secondary} aria-label={`Adicionar cartão em ${col.name}`}>+</button>
                </form>
              )}
            </section>
          );
        })}
        {editable && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addColumn(e.currentTarget);
            }}
            className="flex w-60 shrink-0 flex-col gap-2 self-start rounded-xl border border-dashed border-border p-3"
          >
            <label htmlFor="nova-coluna" className="text-sm font-medium">Nova coluna</label>
            <input id="nova-coluna" name="name" maxLength={40} required className="min-h-11 rounded-lg border border-border bg-surface px-2 text-sm" />
            <button type="submit" className={buttonStyles.secondary}>Adicionar coluna</button>
          </form>
        )}
      </div>

      {openCardData && (
        <CardDialog
          card={openCardData}
          workspaceId={props.workspaceId}
          labels={props.labels}
          members={props.members}
          viewerId={props.viewer.id}
          editable={editable}
          onClose={() => setOpenCard(null)}
          onSaved={(card) => dispatch({ type: "card_upsert", card })}
          onDeleted={(id) => {
            dispatch({ type: "card_deleted", id });
            setOpenCard(null);
          }}
          onConflict={async () => {
            await refetch();
          }}
        />
      )}
      {movingCard && (
        <MoveDialog
          card={movingCard}
          state={state}
          onClose={() => setMoving(null)}
          onMove={async (columnId, afterId) => {
            setMoving(null);
            await move(movingCard.id, columnId, afterId);
          }}
        />
      )}
    </div>
  );
}

function CardItem(props: {
  card: Card;
  labels: Label[];
  assignee?: string;
  editable: boolean;
  today: string;
  dragging: boolean;
  onOpen: () => void;
  onMove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const { card } = props;
  const cardLabels = props.labels.filter((l) => card.label_ids?.includes(l.id));
  const overdue = card.due_on && card.due_on < props.today;
  return (
    <li
      draggable={props.editable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => props.editable && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onDropBefore();
      }}
      className={`rounded-lg border border-border bg-background p-3 text-sm shadow-sm ${props.dragging ? "opacity-50" : ""} ${props.editable ? "cursor-grab" : ""}`}
    >
      {cardLabels.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1" aria-label="Etiquetas">
          {cardLabels.map((l) => (
            <li key={l.id} className="rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: l.color }}>{l.name}</li>
          ))}
        </ul>
      )}
      <button type="button" onClick={props.onOpen} className="w-full text-left font-medium hover:underline">
        {card.title}
      </button>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {card.due_on && (
            <span className={overdue ? "font-semibold text-danger" : ""}>
              Prazo {card.due_on.split("-").reverse().join("/")}{overdue ? " (atrasado)" : ""}
            </span>
          )}
          {props.assignee && <span>{card.due_on ? " · " : ""}{props.assignee}</span>}
        </span>
        {props.editable && (
          <button type="button" onClick={props.onMove} className="rounded px-1.5 py-0.5 hover:bg-surface">
            Mover <span className="sr-only">{card.title}</span>
          </button>
        )}
      </div>
    </li>
  );
}
