// Papéis e permissões de interface (sem dependências de servidor: usável no navegador).
// A autorização real acontece no banco (RLS e funções); isto só decide o que mostrar.

export type MemberRole = "dono" | "admin" | "membro" | "leitor";

export const ROLE_LABEL: Record<MemberRole, string> = {
  dono: "Dono",
  admin: "Administrador",
  membro: "Membro",
  leitor: "Leitor",
};

export const canEdit = (r: MemberRole | null | undefined) => r === "dono" || r === "admin" || r === "membro";
export const canManage = (r: MemberRole | null | undefined) => r === "dono" || r === "admin";
