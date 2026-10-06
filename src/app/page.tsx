import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/button-styles";
import { getViewer } from "@/lib/auth";

export default async function HomePage() {
  if (await getViewer()) redirect("/painel");
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col items-start gap-4 py-6">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight">Um quadro de tarefas que a equipe inteira vê ao vivo.</h1>
        <p className="max-w-xl text-lg text-muted">
          Mova um cartão e seus colegas veem na hora. Se duas pessoas editarem o mesmo cartão, ninguém perde trabalho
          sem aviso.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/entrar" className={buttonStyles.primary}>Entrar com conta demo</Link>
          <Link href="/cadastrar" className={buttonStyles.secondary}>Criar conta</Link>
        </div>
      </section>
      <section aria-labelledby="destaques" className="grid gap-4 sm:grid-cols-3">
        <h2 id="destaques" className="sr-only">Destaques</h2>
        {[
          ["Tempo real de verdade", "Cartões, colunas e comentários aparecem para todos sem recarregar, e você vê quem está no quadro."],
          ["Sem sobrescrever o colega", "Edições simultâneas no mesmo cartão são detectadas; a segunda pessoa vê a versão atual."],
          ["Cada equipe no seu espaço", "Convites por e-mail, papéis por espaço e canais privados: ninguém de fora vê seus quadros."],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
