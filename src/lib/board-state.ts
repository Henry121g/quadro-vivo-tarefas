// Estado do quadro no cliente e aplicação de eventos em tempo real. Funções puras (testáveis).

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
}

export interface Card {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  position: number;
  due_on: string | null;
  assignee_id: string | null;
  version: number;
  updated_at: string;
  label_ids?: string[];
}

export interface BoardState {
  columns: Column[];
  cards: Card[];
}

export type BoardEvent =
  | { type: "card_upsert"; card: Card }
  | { type: "card_deleted"; id: string }
  | { type: "card_labels"; card_id: string; label_ids: string[] }
  | { type: "column_upsert"; column: Column }
  | { type: "column_deleted"; id: string };

const num = (v: unknown) => (typeof v === "string" ? Number(v) : (v as number));

export function normalizeCard(raw: Record<string, unknown>): Card {
  return { ...(raw as unknown as Card), position: num(raw.position), version: num(raw.version) };
}

export function normalizeColumn(raw: Record<string, unknown>): Column {
  return { ...(raw as unknown as Column), position: num(raw.position) };
}

/**
 * Aplica um evento. Cartões só são substituídos por versões iguais ou mais novas: um evento
 * atrasado (chegou depois de um mais novo, ou depois de recarregar o quadro) é ignorado.
 */
export function applyEvent(state: BoardState, ev: BoardEvent): BoardState {
  switch (ev.type) {
    case "card_upsert": {
      const current = state.cards.find((c) => c.id === ev.card.id);
      if (current && current.version > ev.card.version) return state;
      const merged = { ...ev.card, label_ids: ev.card.label_ids ?? current?.label_ids ?? [] };
      return { ...state, cards: current ? state.cards.map((c) => (c.id === ev.card.id ? merged : c)) : [...state.cards, merged] };
    }
    case "card_deleted":
      return { ...state, cards: state.cards.filter((c) => c.id !== ev.id) };
    case "card_labels":
      return { ...state, cards: state.cards.map((c) => (c.id === ev.card_id ? { ...c, label_ids: ev.label_ids } : c)) };
    case "column_upsert": {
      const exists = state.columns.some((c) => c.id === ev.column.id);
      return {
        ...state,
        columns: exists ? state.columns.map((c) => (c.id === ev.column.id ? ev.column : c)) : [...state.columns, ev.column],
      };
    }
    case "column_deleted":
      return {
        columns: state.columns.filter((c) => c.id !== ev.id),
        cards: state.cards.filter((c) => c.column_id !== ev.id),
      };
  }
}

export function sortedColumns(state: BoardState): Column[] {
  return [...state.columns].sort((a, b) => a.position - b.position);
}

export function cardsOf(state: BoardState, columnId: string): Card[] {
  return state.cards.filter((c) => c.column_id === columnId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Para soltar `cardId` na coluna `columnId` antes do cartão `beforeId` (null = no fim), devolve o
 * cartão que ficará imediatamente acima (`after`), que é o que o servidor espera.
 */
export function afterForDrop(state: BoardState, cardId: string, columnId: string, beforeId: string | null): string | null {
  const list = cardsOf(state, columnId).filter((c) => c.id !== cardId);
  if (beforeId === null) return list.at(-1)?.id ?? null;
  const idx = list.findIndex((c) => c.id === beforeId);
  if (idx <= 0) return null;
  return list[idx - 1].id;
}

/** Movimento otimista local (posição provisória entre vizinhos); o servidor confirma a posição real. */
export function moveLocally(state: BoardState, cardId: string, columnId: string, afterId: string | null): BoardState {
  const list = cardsOf(state, columnId).filter((c) => c.id !== cardId);
  const idx = afterId ? list.findIndex((c) => c.id === afterId) : -1;
  const prev = idx >= 0 ? list[idx].position : null;
  const next = list[idx + 1]?.position ?? null;
  const position = prev === null && next === null ? 1024 : prev === null ? next! - 1024 : next === null ? prev + 1024 : (prev + next) / 2;
  return { ...state, cards: state.cards.map((c) => (c.id === cardId ? { ...c, column_id: columnId, position } : c)) };
}
