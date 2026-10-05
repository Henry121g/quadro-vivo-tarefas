// Cria/redefine o espaço "Time Demo" com duas contas públicas (membros) para testar o tempo real.
// Uso: pnpm seed:demo   (também roda diariamente no GitHub Actions)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { db: { schema: "tarefas" }, auth: { persistSession: false } });
const PASSWORD = "demo12345"; // contas públicas sem papel de dono/admin
const USERS = [
  { email: "ana@tarefas.demo.test", name: "Ana (demo)" },
  { email: "beto@tarefas.demo.test", name: "Beto (demo)" },
];
const DONO = { email: "dono@tarefas.demo.test", name: "Dono do espaço demo" }; // senha aleatória, não publicada

const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
async function recreate(email: string, name: string, password: string) {
  const old = list.users.find((u) => u.email === email);
  if (old) await admin.auth.admin.deleteUser(old.id); // cascata remove perfil, espaços pessoais e vínculos
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { app: "tarefas", full_name: name },
  });
  if (error) throw error;
  return data.user.id;
}

// O espaço demo pertence a uma conta técnica sem senha conhecida; Ana e Beto entram como membros.
await admin.from("workspaces").delete().eq("name", "Time Demo");
const donoId = await recreate(DONO.email, DONO.name, crypto.randomUUID() + crypto.randomUUID());
const ids: string[] = [];
for (const u of USERS) ids.push(await recreate(u.email, u.name, PASSWORD));

const { data: ws, error } = await admin.rpc("setup_workspace", { p_user: donoId, p_name: "Time Demo" });
if (error) throw error;
for (const id of ids) {
  const { error: e } = await admin.from("members").insert({ workspace_id: ws, user_id: id, role: "membro" });
  if (e) throw e;
}
console.log(`✓ Espaço "Time Demo" com ${USERS.map((u) => u.email).join(" e ")} (senha ${PASSWORD}).`);
