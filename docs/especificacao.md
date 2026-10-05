# Projeto 5 — Gestor colaborativo de tarefas em tempo real

## Problema
Equipes pequenas organizam tarefas em quadros, mas ferramentas simples não mostram a mudança do
colega na hora, sobrescrevem edições simultâneas sem avisar ou não separam bem quem vê o quê.

## Público
Equipes pequenas (estudos, freelas, times de produto) que querem um kanban compartilhado.

## Funcionalidades
- Espaços de trabalho com membros e papéis; **convites** por e-mail (link de aceite).
- Quadros, colunas e cartões; responsável, prazo, etiquetas e comentários.
- **Arrastar e soltar** (mouse) e **mover por teclado/menu** (acessível e funciona em telas de toque).
- **Tempo real:** mudanças de outras pessoas aparecem sem recarregar; quem está no quadro aparece (presença).
- Histórico de atividades por quadro.

## Papéis (por espaço)
| Papel | Pode |
|---|---|
| `dono` | Tudo, inclusive mudar papéis de membros |
| `admin` | Convidar, gerenciar quadros e etiquetas |
| `membro` | Criar, editar, mover e comentar cartões; criar e renomear colunas |
| `leitor` | Ver e acompanhar em tempo real |

## Regras técnicas
- **Tempo real:** triggers publicam eventos com `realtime.send` em canais **privados**
  `tarefas:board:<id>`; a RLS em `realtime.messages` só autoriza membros do espaço do quadro.
- **Conflitos:** cada cartão tem `version`. Edições e movimentos enviam a versão que o usuário viu;
  se outra pessoa alterou antes, o banco recusa (`CONFLITO`) e a interface recarrega o cartão e avisa —
  nada é sobrescrito silenciosamente.
- **Ordenação:** posição `numeric` (fração entre vizinhos), calculada no servidor; sem reordenar a coluna inteira.
- **Reconexão:** ao reconectar o canal (ou voltar à aba/rede), o quadro é recarregado do servidor para
  recuperar eventos perdidos; um aviso “Reconectando…” fica visível enquanto isso.
- **Isolamento:** RLS por espaço em todas as tabelas; FKs compostas `(workspace_id, id)` impedem
  mover cartão para coluna de outro espaço ou atribuir a não membro.
- **Histórico:** triggers registram criação, edição relevante, movimento, comentário e exclusão.

## Critérios de aceite
1. Duas sessões no mesmo quadro: criar/mover/editar/comentar numa aparece na outra sem recarregar.
2. Duas pessoas editam o mesmo cartão: a segunda recebe aviso de conflito e vê a versão atual.
3. Ao perder a conexão e voltar, o quadro fica consistente com o servidor.
4. Usuário de outro espaço não lê o quadro nem recebe seus eventos (RLS em tabelas e no canal).
5. Leitor não altera nada; membro não gerencia membros.
6. Convite só pode ser aceito pelo e-mail convidado, uma vez, antes de expirar.
7. Interface acessível (teclado, leitores de tela), responsiva, com estados de carregamento/erro/vazio.
