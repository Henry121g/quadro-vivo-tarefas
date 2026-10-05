# Guia de estudo — Quadro Vivo

## Pitch de 30 segundos
“É um kanban colaborativo em tempo real. O banco publica cada mudança num canal privado por quadro,
autorizado pela mesma RLS das tabelas. Edições simultâneas no mesmo cartão são detectadas por versão,
e ao reconectar o cliente recarrega o quadro para não perder nada.”

## Onde está cada coisa
| Assunto | Arquivo |
|---|---|
| Tabelas, RLS, triggers, convites | `supabase/migrations/20261007000000_tarefas_schema.sql` |
| Assinatura do canal, presença, reconexão | `src/app/quadros/[id]/board-view.tsx` |
| Aplicação de eventos e versões | `src/lib/board-state.ts` (+ testes) |
| Conflito na edição | `src/app/quadros/[id]/card-dialog.tsx` |
| Verificação com duas sessões | `scripts/realtime-check.mts` |

## Perguntas prováveis

**“Como você garante que só membros recebem os eventos?”** Canal privado + RLS em `realtime.messages`
chamando `can_access_topic(realtime.topic())`. Mostre o teste em que o intruso não lê o tópico e não
consegue publicar presença.

**“O que acontece se duas pessoas editam o mesmo cartão?”** Versão otimista: a segunda recebe `CONFLITO`.
Compare com “last write wins” (perda silenciosa) e com locks pessimistas (travam a interface).

**“E se a conexão cair?”** Broadcast não guarda histórico para quem estava offline. Na volta ao
`SUBSCRIBED`, recarrego o quadro. Eventos fora de ordem não regridem o estado graças à versão.

**“Por que posição numeric?”** Evita reescrever todas as posições da coluna a cada movimento.
Contraponto: os números crescem em casas decimais; uma rotina de rebalanceamento resolveria se preciso.

**“Por que não guardar o token do convite?”** Se o banco vazar, tokens em claro permitiriam entrar em
espaços. Só o hash fica gravado — como uma senha.

**“Funciona na Vercel?”** Sim: a conexão persistente é entre o navegador e o Supabase Realtime; as funções
serverless não mantêm WebSocket.

## Exercícios
1. Adicione um evento de “digitando…” usando Presence.
2. Implemente rebalanceamento de posições quando a diferença entre vizinhos ficar menor que 1e-9.
3. Escreva um teste Playwright com dois contextos de navegador para o critério “duas sessões”.
