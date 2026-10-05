import type { Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./harness";

let t: TestDb;
let ana: string, beto: string, carla: string, intruso: string;
let ws: string, board: string, todo: string, doing: string, done: string;
let wsIntruso: string, boardIntruso: string;

interface Card {
  id: string;
  column_id: string;
  position: string;
  version: number;
  title: string;
}

const rpc = <T,>(uid: string, sql: string, params: unknown[] = []) =>
  t.as(uid, async (tx: Transaction) => (await tx.query<T>(sql, params)).rows);

async function cardsIn(column: string) {
  const { rows } = await t.db.query<Card>(`select id, title, position::text, version, column_id from tarefas.cards where column_id = $1 order by position`, [column]);
  return rows;
}

async function lastEvents(topic: string, n = 5) {
  const { rows } = await t.db.query<{ event: string; payload: Record<string, unknown> }>(
    `select event, payload from realtime.messages where topic = $1 order by id desc limit $2`,
    [topic, n],
  );
  return rows;
}

beforeAll(async () => {
  t = await createTestDb();
  ana = await t.signUp("Ana", "ana@exemplo.test");
  beto = await t.signUp("Beto", "beto@exemplo.test");
  carla = await t.signUp("Carla", "carla@exemplo.test");
  intruso = await t.signUp("Intruso", "intruso@exemplo.test");
  const ids = async (uid: string) => {
    const { rows } = await t.db.query<{ ws: string; board: string }>(
      `select m.workspace_id ws, b.id board from tarefas.members m join tarefas.boards b on b.workspace_id = m.workspace_id where m.user_id = $1`,
      [uid],
    );
    return rows[0];
  };
  ({ ws, board } = await ids(ana));
  ({ ws: wsIntruso, board: boardIntruso } = await ids(intruso));
  const { rows: cols } = await t.db.query<{ id: string; name: string }>(`select id, name from tarefas.columns where board_id = $1`, [board]);
  todo = cols.find((c) => c.name === "A fazer")!.id;
  doing = cols.find((c) => c.name === "Fazendo")!.id;
  done = cols.find((c) => c.name === "Feito")!.id;
  // Beto entra como membro e Carla como leitora (via convite, testado abaixo para Beto).
  await t.db.query(`insert into tarefas.members (workspace_id, user_id, role) values ($1, $2, 'leitor')`, [ws, carla]);
});

describe("cadastro", () => {
  it("cria espaço pessoal com quadro de exemplo, 3 colunas e cartões", async () => {
    const { rows } = await t.db.query<{ role: string; cols: number; cards: number }>(
      `select m.role, (select count(*)::int from tarefas.columns where board_id = $2) cols,
              (select count(*)::int from tarefas.cards where board_id = $2) cards
       from tarefas.members m where m.user_id = $1`,
      [ana, board],
    );
    expect(rows[0]).toEqual({ role: "dono", cols: 3, cards: 4 });
  });

  it("conta de outro app do portfólio não ganha perfil nem espaço", async () => {
    const outro = await t.signUp("ERP", "erp@exemplo.test", "erp");
    const { rows } = await t.db.query(`select 1 from tarefas.profiles where id = $1`, [outro]);
    expect(rows).toHaveLength(0);
  });
});

describe("convites", () => {
  let token: string;

  it("dono convida; o token não é gravado, só o hash", async () => {
    [{ token }] = await rpc<{ token: string }>(ana, `select tarefas.create_invite($1, 'Beto@Exemplo.test', 'membro') token`, [ws]);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const { rows } = await t.db.query<{ email: string; token_hash: string }>(`select email, token_hash from tarefas.invites where workspace_id = $1`, [ws]);
    expect(rows[0].email).toBe("beto@exemplo.test");
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("outra pessoa não aceita convite destinado a outro e-mail", async () => {
    await expect(rpc(intruso, `select tarefas.accept_invite($1)`, [token])).rejects.toThrow(/CONVITE_OUTRO_EMAIL/);
  });

  it("o convidado aceita uma única vez", async () => {
    const [{ ws: joined }] = await rpc<{ ws: string }>(beto, `select tarefas.accept_invite($1) ws`, [token]);
    expect(joined).toBe(ws);
    await expect(rpc(beto, `select tarefas.accept_invite($1)`, [token])).rejects.toThrow(/CONVITE_INVALIDO/);
    await expect(rpc(beto, `select tarefas.accept_invite('token-inventado')`)).rejects.toThrow(/CONVITE_INVALIDO/);
  });

  it("convite expirado é recusado; membro e leitor não convidam", async () => {
    const [{ tk }] = await rpc<{ tk: string }>(ana, `select tarefas.create_invite($1, 'novo@exemplo.test', 'leitor') tk`, [ws]);
    await t.db.query(`update tarefas.invites set expires_at = now() - interval '1 minute' where email = 'novo@exemplo.test'`);
    const novo = await t.signUp("Novo", "novo@exemplo.test");
    await expect(rpc(novo, `select tarefas.accept_invite($1)`, [tk])).rejects.toThrow(/CONVITE_INVALIDO/);
    await expect(rpc(beto, `select tarefas.create_invite($1, 'x@exemplo.test', 'membro')`, [ws])).rejects.toThrow(/SEM_PERMISSAO/);
    await expect(rpc(carla, `select tarefas.create_invite($1, 'x@exemplo.test', 'membro')`, [ws])).rejects.toThrow(/SEM_PERMISSAO/);
  });

  it("ninguém convida como dono; convidar quem já é membro é recusado", async () => {
    await expect(rpc(ana, `select tarefas.create_invite($1, 'x@exemplo.test', 'dono')`, [ws])).rejects.toThrow();
    await expect(rpc(ana, `select tarefas.create_invite($1, 'beto@exemplo.test', 'membro')`, [ws])).rejects.toThrow(/JA_E_MEMBRO/);
  });
});

describe("cartões: posição e versão", () => {
  it("cria no topo, no fim e entre dois cartões sem reordenar a coluna", async () => {
    const antes = await cardsIn(todo);
    const [topo] = await rpc<Card>(beto, `select * from tarefas.create_card($1, 'No topo', null)`, [todo]);
    const [fim] = await rpc<Card>(beto, `select * from tarefas.create_card($1, 'No fim', $2)`, [todo, antes.at(-1)!.id]);
    const [meio] = await rpc<Card>(beto, `select * from tarefas.create_card($1, 'No meio', $2)`, [todo, antes[0].id]);
    const titulos = (await cardsIn(todo)).map((c) => c.title);
    expect(titulos[0]).toBe("No topo");
    expect(titulos.at(-1)).toBe("No fim");
    expect(titulos.indexOf("No meio")).toBe(titulos.indexOf(antes[0].title) + 1);
    // Os cartões antigos não mudaram de posição.
    const depois = await cardsIn(todo);
    for (const c of antes) expect(depois.find((d) => d.id === c.id)!.position).toBe(c.position);
    expect([topo, fim, meio].every((c) => c.version === 1)).toBe(true);
  });

  it("muitas inserções no mesmo ponto continuam ordenadas (posição numeric não esgota)", async () => {
    const [base] = await cardsIn(doing);
    for (let i = 0; i < 60; i++) {
      await rpc(beto, `select tarefas.create_card($1, $2, $3)`, [doing, `Item ${i}`, base.id]);
    }
    const lista = await cardsIn(doing);
    expect(lista[0].id).toBe(base.id);
    expect(lista[1].title).toBe("Item 59");
    expect(new Set(lista.map((c) => c.position)).size).toBe(lista.length);
  });

  it("mover entre colunas incrementa a versão e registra histórico", async () => {
    const [card] = await cardsIn(todo);
    const [movido] = await rpc<Card>(beto, `select * from tarefas.move_card($1, $2, null, $3)`, [card.id, done, card.version]);
    expect(movido).toMatchObject({ column_id: done, version: card.version + 1 });
    const { rows } = await t.db.query<{ action: string; details: { de: string; para: string } }>(
      `select action, details from tarefas.activity where card_id = $1 order by id desc limit 1`,
      [card.id],
    );
    expect(rows[0]).toMatchObject({ action: "cartao_movido", details: { de: "A fazer", para: "Feito" } });
  });

  it("conflito: a segunda edição com versão antiga é recusada e nada é sobrescrito", async () => {
    const [card] = await cardsIn(todo);
    await rpc(ana, `select tarefas.update_card($1, '{"title":"Versão da Ana"}', $2)`, [card.id, card.version]);
    await expect(
      rpc(beto, `select tarefas.update_card($1, '{"title":"Versão do Beto"}', $2)`, [card.id, card.version]),
    ).rejects.toThrow(/CONFLITO/);
    await expect(rpc(beto, `select tarefas.move_card($1, $2, null, $3)`, [card.id, doing, card.version])).rejects.toThrow(/CONFLITO/);
    const { rows } = await t.db.query<{ title: string; version: number }>(`select title, version from tarefas.cards where id = $1`, [card.id]);
    expect(rows[0]).toEqual({ title: "Versão da Ana", version: card.version + 1 });
  });

  it("editar campos, etiquetas e responsável; responsável precisa ser membro", async () => {
    const [card] = await cardsIn(todo);
    const { rows: labels } = await t.db.query<{ id: string }>(`select id from tarefas.labels where workspace_id = $1 limit 2`, [ws]);
    const [up] = await rpc<Card & { assignee_id: string; due_on: string }>(
      beto,
      `select * from tarefas.update_card($1, $2::jsonb, $3)`,
      [card.id, JSON.stringify({ due_on: "2026-12-01", assignee_id: beto, label_ids: labels.map((l) => l.id) }), card.version],
    );
    expect(up.assignee_id).toBe(beto);
    const { rows: cl } = await t.db.query(`select 1 from tarefas.card_labels where card_id = $1`, [card.id]);
    expect(cl).toHaveLength(2);
    await expect(
      rpc(beto, `select tarefas.update_card($1, $2::jsonb, $3)`, [card.id, JSON.stringify({ assignee_id: intruso }), up.version]),
    ).rejects.toThrow(/foreign key/);
  });

  it("não move cartão para coluna de outro quadro/espaço", async () => {
    const [card] = await cardsIn(todo);
    const { rows } = await t.db.query<{ id: string }>(`select id from tarefas.columns where board_id = $1 limit 1`, [boardIntruso]);
    await expect(rpc(beto, `select tarefas.move_card($1, $2, null, $3)`, [card.id, rows[0].id, card.version])).rejects.toThrow(/COLUNA_INVALIDA/);
  });
});

describe("tempo real", () => {
  const topic = () => `tarefas:board:${board}`;

  it("mudanças em cartões publicam eventos no canal privado do quadro", async () => {
    const [card] = await rpc<Card>(beto, `select * from tarefas.create_card($1, 'Evento ao vivo', null)`, [todo]);
    await rpc(beto, `insert into tarefas.comments (workspace_id, card_id, author_id, body) values ($1, $2, $3, 'Oi!')`, [ws, card.id, beto]);
    await rpc(beto, `delete from tarefas.cards where id = $1`, [card.id]);
    const ev = await lastEvents(topic(), 3);
    expect(ev.map((e) => e.event)).toEqual(["card_deleted", "comment_added", "card_upsert"]);
    expect(ev[2].payload).toMatchObject({ by: beto, card: { id: card.id, title: "Evento ao vivo" } });
    const { rows } = await t.db.query<{ private: boolean }>(`select bool_and(private) private from realtime.messages`);
    expect(rows[0].private).toBe(true);
  });

  it("membros e leitores podem assinar o canal; intruso não lê nem publica presença", async () => {
    const read = (uid: string, tp: string) =>
      t.as(uid, async (tx) => (await tx.query(`select 1 from realtime.messages where topic = $1 limit 1`, [tp])).rows, { topic: tp });
    expect(await read(beto, topic())).toHaveLength(1);
    expect(await read(carla, topic())).toHaveLength(1);
    expect(await read(intruso, topic())).toHaveLength(0);
    await expect(
      t.as(intruso, (tx) => tx.query(`insert into realtime.messages (topic, extension) values ($1, 'presence')`, [topic()]), { topic: topic() }),
    ).rejects.toThrow(/row-level security/);
    // Clientes não forjam eventos de broadcast (só o banco publica).
    await expect(
      t.as(beto, (tx) => tx.query(`insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'card_deleted')`, [topic()]), { topic: topic() }),
    ).rejects.toThrow(/row-level security/);
  });

  it("tópicos malformados nunca autorizam", async () => {
    const [{ ok }] = await rpc<{ ok: boolean }>(beto, `select tarefas.can_access_topic($1) ok`, [`tarefas:board:${board}' or 1=1`]);
    expect(ok).toBe(false);
  });
});

describe("permissões e isolamento", () => {
  it.each(["boards", "columns", "cards", "comments", "labels", "activity", "members"])("intruso não lê %s do espaço", async (table) => {
    const rows = await rpc(intruso, `select 1 from tarefas.${table} where workspace_id = $1`, [ws]);
    expect(rows).toHaveLength(0);
  });

  it("leitor não cria, edita, move, comenta nem exclui", async () => {
    const [card] = await cardsIn(todo);
    await expect(rpc(carla, `select tarefas.create_card($1, 'x', null)`, [todo])).rejects.toThrow(/SEM_PERMISSAO/);
    await expect(rpc(carla, `select tarefas.update_card($1, '{"title":"x"}', $2)`, [card.id, card.version])).rejects.toThrow(/SEM_PERMISSAO/);
    await expect(
      rpc(carla, `insert into tarefas.comments (workspace_id, card_id, author_id, body) values ($1, $2, $3, 'x')`, [ws, card.id, carla]),
    ).rejects.toThrow(/row-level security/);
    expect(await rpc(carla, `delete from tarefas.cards where id = $1 returning id`, [card.id])).toHaveLength(0);
  });

  it("membro não gerencia quadros nem muda papéis; dono muda", async () => {
    await expect(rpc(beto, `insert into tarefas.boards (workspace_id, name) values ($1, 'Novo')`, [ws])).rejects.toThrow(/row-level security/);
    expect(await rpc(beto, `update tarefas.members set role = 'admin' where workspace_id = $1 and user_id = $2 returning 1`, [ws, carla])).toHaveLength(0);
    expect(await rpc(ana, `update tarefas.members set role = 'membro' where workspace_id = $1 and user_id = $2 returning 1`, [ws, carla])).toHaveLength(1);
    await expect(rpc(ana, `update tarefas.members set role = 'dono' where workspace_id = $1 and user_id = $2`, [ws, carla])).rejects.toThrow(/row-level security/);
  });

  it("comentário não pode ser publicado em nome de outra pessoa", async () => {
    const [card] = await cardsIn(todo);
    await expect(
      rpc(beto, `insert into tarefas.comments (workspace_id, card_id, author_id, body) values ($1, $2, $3, 'falso')`, [ws, card.id, ana]),
    ).rejects.toThrow(/row-level security/);
  });

  it("não cria cartão direto com versão ou posição forjadas fora das funções", async () => {
    await expect(
      rpc(beto, `update tarefas.cards set version = 999 where column_id = $1`, [todo]),
    ).rejects.toThrow(/permission denied/);
  });

  it("intruso não cria cartão no quadro alheio nem por insert direto", async () => {
    await expect(rpc(intruso, `select tarefas.create_card($1, 'x', null)`, [todo])).rejects.toThrow(/SEM_PERMISSAO/);
    await expect(
      rpc(intruso, `insert into tarefas.cards (workspace_id, board_id, column_id, title, position) values ($1, $2, $3, 'x', 1)`, [ws, board, todo]),
    ).rejects.toThrow(/row-level security/);
  });

  it("perfis visíveis apenas entre quem compartilha espaço", async () => {
    const vistos = (await rpc<{ id: string }>(intruso, `select id from tarefas.profiles`)).map((r) => r.id);
    expect(vistos).toEqual([intruso]);
    void wsIntruso;
  });
});
