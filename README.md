# Quadro Vivo — tarefas colaborativas em tempo real

> Projeto de portfólio com **dados fictícios**, desenvolvido com assistência de IA (Claude Code).
> Nenhuma equipe, pessoa ou tarefa é real.

**Demonstração:** [quadro-vivo-tarefas.vercel.app](https://quadro-vivo-tarefas.vercel.app) (contas de demonstração em configuração) · **CI:** ver aba Actions

<!-- Screenshots reais (incluindo duas sessões lado a lado) serão adicionadas após o deploy. -->

## O problema

Equipes pequenas usam quadros kanban, mas ferramentas simples não mostram a mudança do colega na hora,
sobrescrevem edições simultâneas sem avisar e nem sempre separam bem quem pode ver cada quadro.

**Público:** equipes pequenas (estudos, freelas, times de produto).

## Funcionalidades

- **Espaços de trabalho** com papéis (dono, administrador, membro, leitor) e **convites** por link.
- **Quadros, colunas e cartões** com responsável, prazo, etiquetas, descrição e **comentários**.
- **Arrastar e soltar** com o mouse e **“Mover”** por teclado/menu (funciona com leitor de tela e em telas de toque).
- **Tempo real:** cartões, colunas e comentários aparecem para todos sem recarregar; indicador de quem
  está no quadro (presença) e de estado da conexão.
- **Conflitos:** duas pessoas editando o mesmo cartão → a segunda é avisada e vê a versão atual.
- **Histórico de atividades** por quadro.

### Como ver o tempo real

1. Abra a demonstração numa janela normal e entre com `ana@tarefas.demo.test`.
2. Numa janela anônima, entre com `beto@tarefas.demo.test` (senha das duas: `demo12345`).
3. Abra o quadro do espaço **Time Demo** nas duas e mova/edite cartões.

As duas contas são **membros** (não administram o espaço). Os dados são redefinidos diariamente.

## Decisões técnicas

### 1. Tempo real com canais privados autorizados pelo banco
Triggers nas tabelas publicam eventos com `realtime.send` no tópico `tarefas:board:<id>`, marcado como
**privado**. O Supabase Realtime consulta a **RLS de `realtime.messages`** antes de entregar qualquer
mensagem: a política chama `tarefas.can_access_topic(realtime.topic())`, que só aceita membros do espaço
do quadro. Clientes podem publicar **presença**, mas não forjar eventos de broadcast (só o banco publica).

*Por que Broadcast em vez de Postgres Changes?* O payload é controlado pelo trigger (um evento por ação,
com o autor), e a autorização fica num único ponto — o tópico do quadro.

### 2. Conflitos de edição: versão otimista
Cada cartão tem `version`, incrementada por trigger a cada alteração. `update_card` e `move_card` recebem
a versão que o usuário viu; se não bate, o banco responde `CONFLITO` e **nada é gravado**. A interface
recarrega o cartão e avisa. Se o cartão muda enquanto o diálogo está aberto e a pessoa não editou nada,
o formulário se atualiza sozinho; se ela já editou, aparece o aviso antes de salvar.

### 3. Reconexão sem perder eventos
Eventos enviados enquanto o cliente estava offline não são reenviados. Por isso, ao voltar ao estado
`SUBSCRIBED` depois de uma queda — e ao voltar para a aba ou para a rede — o quadro é **recarregado do
servidor**. Eventos atrasados são ignorados se trouxerem versão mais antiga que a já conhecida
(`applyEvent`, testado).

### 4. Ordenação sem reescrever a coluna
Posição `numeric` (precisão arbitrária): mover um cartão grava só ele, com a média entre os vizinhos,
calculada no banco. Um teste insere 60 cartões no mesmo ponto e confirma a ordem.

### 5. Isolamento e permissões
RLS por espaço em todas as tabelas; **FKs compostas** impedem mover cartão para coluna de outro quadro e
atribuir responsável que não seja membro. Convites guardam só o **hash SHA-256** do token, expiram em 7
dias, são de uso único e exigem que o e-mail logado seja o convidado.

### 6. Hospedagem serverless
Nenhuma conexão persistente roda na Vercel: o navegador conecta direto ao Supabase Realtime (WebSocket
gerenciado). As funções da Vercel só atendem requisições HTTP.

## Design

Identidade visual baseada no sistema `minimal` do [open-design](https://github.com/nexu-io/open-design)
(licença Apache-2.0): branco, preto e bordas finas, cantos quase retos. Os tokens foram adaptados em `src/app/globals.css`, com
tons de texto ajustados para contraste AA (WCAG 4,5:1) e a cor da marca separada em preenchimento
(botões) e texto (links e foco). Cada app do portfólio usa um sistema diferente.

## Arquitetura

```
Navegador A ──rpc move_card──► Postgres (schema tarefas) ──trigger──► realtime.send(tópico privado)
                                    │ RLS + versão otimista                    │
Navegador B ◄──── WebSocket (Supabase Realtime, RLS em realtime.messages) ◄────┘
Next.js 16 (Server Components): carrega o estado inicial do quadro e as telas de espaços/convites.
```

**Tecnologias:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS,
Realtime Broadcast/Presence) · Zod · Sentry · Vitest · PGlite · GitHub Actions · Vercel.

## Como executar

```bash
pnpm install
cp .env.example .env.local
```

1. Supabase → **Project Settings → API → Exposed schemas**: adicione `tarefas`.
2. Supabase → **Realtime → Settings**: desligue **Allow public access** (exige autorização em todos os canais).
3. Aplique `supabase/migrations/` e rode `pnpm seed:demo`.
4. `pnpm dev` → http://localhost:3000

## Testes

```bash
pnpm test            # estado do quadro (eventos, versões, arrastar) + banco com PGlite
pnpm test:tempo-real # duas sessões reais: B recebe o movimento de A; intruso é recusado no canal
pnpm lint && pnpm typecheck && pnpm build
```

Os testes de banco usam um stub do Realtime (`realtime.send` grava em `realtime.messages`, como no
Supabase) para verificar quais eventos são publicados e se a RLS do canal recusa quem não é membro.

## Limitações

- **E-mail de convite:** o link é gerado e exibido para copiar; o envio pelo Resend está **pendente** de
  domínio verificado.
- O arrastar e soltar nativo não funciona em telas de toque; nelas, use o botão **Mover**.
- Renomear/excluir coluna usa diálogos nativos do navegador.
- Sem anexos, subtarefas ou notificações.

## Melhorias futuras

Envio de convites por e-mail · menções em comentários · filtros por responsável/etiqueta · testes E2E com
Playwright cobrindo duas sessões no CI.

## Guia de estudo

[docs/guia-de-estudo.md](docs/guia-de-estudo.md)

## Transparência sobre o uso de IA

Código, testes e documentação produzidos com assistência do Claude Code (Anthropic), sob minha direção e
revisão. As decisões estão registradas aqui e no histórico de commits.
