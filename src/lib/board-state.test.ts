import { describe, expect, it } from "vitest";
import { afterForDrop, applyEvent, cardsOf, moveLocally, normalizeCard, type BoardState, type Card } from "./board-state";

const card = (id: string, column_id: string, position: number, version = 1): Card => ({
  id,
  board_id: "b",
  column_id,
  title: id,
  description: null,
  position,
  due_on: null,
  assignee_id: null,
  version,
  updated_at: "",
  label_ids: [],
});

const base: BoardState = {
  columns: [
    { id: "c1", board_id: "b", name: "A fazer", position: 1 },
    { id: "c2", board_id: "b", name: "Feito", position: 2 },
  ],
  cards: [card("a", "c1", 1024), card("b", "c1", 2048), card("c", "c1", 3072), card("d", "c2", 1024)],
};

describe("aplicação de eventos", () => {
  it("insere cartão novo e substitui por versão mais nova", () => {
    let s = applyEvent(base, { type: "card_upsert", card: card("e", "c2", 2048) });
    expect(cardsOf(s, "c2").map((c) => c.id)).toEqual(["d", "e"]);
    s = applyEvent(s, { type: "card_upsert", card: { ...card("a", "c2", 500, 2), title: "movido" } });
    expect(cardsOf(s, "c2").map((c) => c.id)).toEqual(["a", "d", "e"]);
  });

  it("ignora evento atrasado com versão antiga (ordem de chegada não importa)", () => {
    const novo = applyEvent(base, { type: "card_upsert", card: { ...card("a", "c2", 10, 3), title: "v3" } });
    const atrasado = applyEvent(novo, { type: "card_upsert", card: { ...card("a", "c1", 10, 2), title: "v2" } });
    expect(atrasado.cards.find((c) => c.id === "a")!.title).toBe("v3");
  });

  it("mantém etiquetas conhecidas quando o evento do cartão não as traz", () => {
    const comEtiqueta = applyEvent(base, { type: "card_labels", card_id: "a", label_ids: ["l1"] });
    const { label_ids, ...semEtiquetas } = card("a", "c1", 1024, 2);
    void label_ids;
    const s = applyEvent(comEtiqueta, { type: "card_upsert", card: semEtiquetas as Card });
    expect(s.cards.find((c) => c.id === "a")!.label_ids).toEqual(["l1"]);
  });

  it("excluir coluna remove seus cartões", () => {
    const s = applyEvent(base, { type: "column_deleted", id: "c1" });
    expect(s.cards.map((c) => c.id)).toEqual(["d"]);
  });

  it("normaliza números vindos como texto (numeric do Postgres)", () => {
    expect(normalizeCard({ ...card("x", "c1", 0), position: "1536.5", version: "4" } as never)).toMatchObject({ position: 1536.5, version: 4 });
  });
});

describe("arrastar e soltar", () => {
  it("calcula o vizinho de cima ao soltar antes de um cartão", () => {
    expect(afterForDrop(base, "c", "c1", "b")).toBe("a");
    expect(afterForDrop(base, "c", "c1", "a")).toBeNull(); // topo
    expect(afterForDrop(base, "a", "c2", null)).toBe("d"); // fim de outra coluna
    expect(afterForDrop(base, "a", "c1", "b")).toBeNull(); // o próprio cartão é ignorado
  });

  it("movimento otimista posiciona entre os vizinhos", () => {
    const s = moveLocally(base, "c", "c1", "a");
    expect(cardsOf(s, "c1").map((c) => c.id)).toEqual(["a", "c", "b"]);
    const topo = moveLocally(base, "d", "c1", null);
    expect(cardsOf(topo, "c1")[0].id).toBe("d");
  });
});
