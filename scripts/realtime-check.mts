// Verificação de ponta a ponta do tempo real contra o Supabase real (duas sessões simultâneas).
// 1) Beto assina o canal privado do quadro; Ana move um cartão → Beto recebe o evento.
// 2) Um usuário de fora tenta assinar o mesmo canal → a assinatura é recusada.
// Pré-requisitos: `pnpm seed:demo` e "Allow public access" do Realtime desligado.
// Uso: pnpm test:tempo-real
import { randomUUID } from "node:crypto";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !anon || !service) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const admin = createClient(url, service, { db: { schema: "tarefas" }, auth: { persistSession: false } });

async function login(email: string, password: string) {
  const c = createClient(url, anon, { db: { schema: "tarefas" }, auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  await c.realtime.setAuth();
  return c;
}

function subscribe(c: Awaited<ReturnType<typeof login>>, topic: string, onEvent: (p: Record<string, unknown>) => void) {
  return new Promise<{ status: string; channel: RealtimeChannel }>((resolve) => {
    const ch = c.channel(topic, { config: { private: true } }).on("broadcast", { event: "card_upsert" }, ({ payload }) => onEvent(payload));
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED" && status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
      resolve({ status, channel: ch });
    });
  });
}

let failed = false;
const tmpEmail = `intruso-${Date.now()}@tarefas.demo.test`;
const tmpPass = randomUUID();
let tmpId: string | undefined;
try {
  const ana = await login("ana@tarefas.demo.test", "demo12345");
  const beto = await login("beto@tarefas.demo.test", "demo12345");
  const { data: ws } = await admin.from("workspaces").select("id").eq("name", "Time Demo").single();
  const { data: board } = await admin.from("boards").select("id").eq("workspace_id", ws!.id).limit(1).single();
  const topic = `tarefas:board:${board!.id}`;

  let received: Record<string, unknown> | null = null;
  const sub = await subscribe(beto, topic, (p) => (received = p));
  console.log(`1) Beto assinou ${topic}: ${sub.status}`);
  if (sub.status !== "SUBSCRIBED") failed = true;

  const { data: cols } = await ana.from("columns").select("id, name").eq("board_id", board!.id).order("position");
  const { data: card } = await ana.from("cards").select("id, version").eq("column_id", cols![0].id).limit(1).single();
  const t0 = Date.now();
  const { error: moveError } = await ana.rpc("move_card", { p_card: card!.id, p_column: cols![1].id, p_after: null, p_expected_version: card!.version });
  if (moveError) throw moveError;
  for (let i = 0; i < 50 && !received; i++) await new Promise((r) => setTimeout(r, 100));
  console.log(received ? `   ✓ Beto recebeu o movimento da Ana em ${Date.now() - t0} ms` : "   ✗ Beto NÃO recebeu o evento em 5 s");
  if (!received) failed = true;
  await beto.removeChannel(sub.channel);

  const { data: u } = await admin.auth.admin.createUser({ email: tmpEmail, password: tmpPass, email_confirm: true, user_metadata: { app: "tarefas", full_name: "Intruso" } });
  tmpId = u.user!.id;
  const intruso = await login(tmpEmail, tmpPass);
  let leaked = false;
  const sub2 = await subscribe(intruso, topic, () => (leaked = true));
  console.log(`2) Intruso tentou assinar o canal: ${sub2.status}`);
  if (sub2.status === "SUBSCRIBED") {
    await ana.rpc("move_card", { p_card: card!.id, p_column: cols![0].id, p_after: null, p_expected_version: card!.version + 1 });
    await new Promise((r) => setTimeout(r, 2000));
    if (leaked) failed = true;
    console.log(leaked ? "   ✗ Intruso recebeu evento!" : "   ✓ Intruso não recebeu eventos");
  } else {
    console.log("   ✓ Assinatura recusada pela RLS de realtime.messages");
  }
} finally {
  if (tmpId) await admin.auth.admin.deleteUser(tmpId);
}
console.log(failed ? "✗ FALHOU" : "✓ OK");
process.exit(failed ? 1 : 0);
