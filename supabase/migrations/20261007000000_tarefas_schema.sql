-- Projeto 5 — Gestor colaborativo de tarefas em tempo real
-- Schema isolado `tarefas` (projeto Supabase compartilhado com outras demos; ver PLANO.md do portfólio).
-- Tempo real: triggers publicam em canais privados `tarefas:board:<id>` (realtime.send);
-- a RLS de realtime.messages só autoriza membros do espaço do quadro.

create schema if not exists tarefas;

create type tarefas.member_role as enum ('dono', 'admin', 'membro', 'leitor');

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table tarefas.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 2 and 100),
  created_at  timestamptz not null default now()
);

create table tarefas.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  created_by  uuid references tarefas.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table tarefas.members (
  workspace_id  uuid not null references tarefas.workspaces (id) on delete cascade,
  user_id       uuid not null references tarefas.profiles (id) on delete cascade,
  role          tarefas.member_role not null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on tarefas.members (user_id);

create table tarefas.invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references tarefas.workspaces (id) on delete cascade,
  email         text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          tarefas.member_role not null check (role <> 'dono'),
  token_hash    text not null unique,      -- sha256 do token; o token em si nunca é gravado
  invited_by    uuid references tarefas.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid references tarefas.profiles (id) on delete set null
);
create unique index invites_pending_unique on tarefas.invites (workspace_id, email) where accepted_at is null;

create table tarefas.boards (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references tarefas.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id)
);

create table tarefas.columns (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  board_id      uuid not null,
  name          text not null check (char_length(name) between 1 and 40),
  position      numeric not null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (board_id, id),
  foreign key (workspace_id, board_id) references tarefas.boards (workspace_id, id) on delete cascade
);
create index on tarefas.columns (board_id, position);

create table tarefas.labels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references tarefas.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 30),
  color         text not null default '#64748b' check (color ~ '^#[0-9a-f]{6}$'),
  unique (workspace_id, id)
);
create unique index labels_ws_name on tarefas.labels (workspace_id, lower(name));

create table tarefas.cards (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  board_id      uuid not null,
  column_id     uuid not null,
  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 5000),
  position      numeric not null,
  due_on        date,
  assignee_id   uuid,
  version       int not null default 1,
  created_by    uuid references tarefas.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references tarefas.profiles (id) on delete set null,
  unique (workspace_id, id),
  foreign key (workspace_id, board_id) references tarefas.boards (workspace_id, id) on delete cascade,
  -- A coluna precisa ser do mesmo quadro (e, portanto, do mesmo espaço).
  foreign key (board_id, column_id) references tarefas.columns (board_id, id) on delete cascade,
  -- Responsável precisa ser membro do espaço; sai do espaço → cartão fica sem responsável.
  foreign key (workspace_id, assignee_id) references tarefas.members (workspace_id, user_id) on delete set null (assignee_id)
);
create index on tarefas.cards (column_id, position);
create index on tarefas.cards (board_id);

create table tarefas.card_labels (
  workspace_id  uuid not null,
  card_id       uuid not null,
  label_id      uuid not null,
  primary key (card_id, label_id),
  foreign key (workspace_id, card_id) references tarefas.cards (workspace_id, id) on delete cascade,
  foreign key (workspace_id, label_id) references tarefas.labels (workspace_id, id) on delete cascade
);

create table tarefas.comments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  card_id       uuid not null,
  author_id     uuid references tarefas.profiles (id) on delete set null,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now(),
  foreign key (workspace_id, card_id) references tarefas.cards (workspace_id, id) on delete cascade
);
create index on tarefas.comments (card_id, created_at);

create table tarefas.activity (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references tarefas.workspaces (id) on delete cascade,
  board_id      uuid references tarefas.boards (id) on delete cascade,
  card_id       uuid,             -- sem FK: o histórico sobrevive à exclusão do cartão
  actor_id      uuid references tarefas.profiles (id) on delete set null,
  action        text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on tarefas.activity (board_id, id desc);

-- ---------------------------------------------------------------------------
-- Permissões auxiliares
-- ---------------------------------------------------------------------------

create or replace function tarefas.my_role(p_ws uuid)
returns tarefas.member_role language sql stable security definer set search_path = '' as $$
  select role from tarefas.members where workspace_id = p_ws and user_id = auth.uid()
$$;

create or replace function tarefas.is_member(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from tarefas.members where workspace_id = p_ws and user_id = auth.uid())
$$;

-- Pode editar cartões, colunas e comentários.
create or replace function tarefas.can_edit(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(tarefas.my_role(p_ws) in ('dono', 'admin', 'membro'), false)
$$;

-- Pode gerenciar quadros, etiquetas e convites.
create or replace function tarefas.can_manage(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(tarefas.my_role(p_ws) in ('dono', 'admin'), false)
$$;

-- Autorização do canal de tempo real: "tarefas:board:<uuid>" → membro do espaço do quadro.
create or replace function tarefas.can_access_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_board uuid;
begin
  if p_topic is null or p_topic !~ '^tarefas:board:[0-9a-f-]{36}$' then
    return false;
  end if;
  v_board := substring(p_topic from 15)::uuid;
  return exists (
    select 1 from tarefas.boards b
    join tarefas.members m on m.workspace_id = b.workspace_id
    where b.id = v_board and m.user_id = auth.uid()
  );
end $$;

-- ---------------------------------------------------------------------------
-- Cartões: versão otimista e posição fracionária
-- ---------------------------------------------------------------------------

create or replace function tarefas.touch_card()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger cards_touch before update on tarefas.cards
  for each row execute function tarefas.touch_card();

-- Posição entre `p_after` (cartão acima; null = topo) e o próximo da coluna.
create or replace function tarefas.position_after(p_column uuid, p_after uuid, p_exclude uuid)
returns numeric language plpgsql stable security invoker set search_path = '' as $$
declare
  v_prev numeric;
  v_next numeric;
begin
  if p_after is not null then
    select position into v_prev from tarefas.cards where id = p_after and column_id = p_column;
    if v_prev is null then
      raise exception 'POSICAO_INVALIDA' using errcode = '22023';
    end if;
  end if;
  select min(position) into v_next from tarefas.cards
  where column_id = p_column and id is distinct from p_exclude
    and (v_prev is null or position > v_prev);
  return case
    when v_prev is null and v_next is null then 1024
    when v_prev is null then v_next - 1024
    when v_next is null then v_prev + 1024
    else (v_prev + v_next) / 2
  end;
end $$;

create or replace function tarefas.create_card(p_column uuid, p_title text, p_after uuid default null)
returns tarefas.cards language plpgsql security invoker set search_path = '' as $$
declare
  v_col tarefas.columns;
  v_card tarefas.cards;
begin
  select * into v_col from tarefas.columns where id = p_column;
  if v_col.id is null or not tarefas.can_edit(v_col.workspace_id) then
    raise exception 'SEM_PERMISSAO' using errcode = '42501';
  end if;
  insert into tarefas.cards (workspace_id, board_id, column_id, title, position, created_by, updated_by)
  values (v_col.workspace_id, v_col.board_id, p_column, trim(p_title),
          tarefas.position_after(p_column, p_after, null), auth.uid(), auth.uid())
  returning * into v_card;
  return v_card;
end $$;

-- Move com verificação de versão: se outra pessoa alterou o cartão, recusa com CONFLITO.
create or replace function tarefas.move_card(p_card uuid, p_column uuid, p_after uuid, p_expected_version int)
returns tarefas.cards language plpgsql security invoker set search_path = '' as $$
declare
  v_ws   uuid;
  v_card tarefas.cards;
  v_col  tarefas.columns;
begin
  -- Permissão antes do bloqueio: sob RLS, FOR UPDATE não enxerga linhas que o usuário não pode alterar.
  select workspace_id into v_ws from tarefas.cards where id = p_card;
  if v_ws is null then
    raise exception 'CARTAO_INEXISTENTE' using errcode = 'P0002';
  end if;
  if not tarefas.can_edit(v_ws) then
    raise exception 'SEM_PERMISSAO' using errcode = '42501';
  end if;
  select * into v_card from tarefas.cards where id = p_card for update;
  if v_card.version <> p_expected_version then
    raise exception 'CONFLITO' using errcode = 'P0001', detail = v_card.version::text;
  end if;
  select * into v_col from tarefas.columns where id = p_column and board_id = v_card.board_id;
  if v_col.id is null then
    raise exception 'COLUNA_INVALIDA' using errcode = '22023';
  end if;
  if p_after = p_card then
    raise exception 'POSICAO_INVALIDA' using errcode = '22023';
  end if;
  update tarefas.cards
  set column_id = p_column, position = tarefas.position_after(p_column, p_after, p_card)
  where id = p_card
  returning * into v_card;
  return v_card;
end $$;

-- Edita campos com verificação de versão. Campos ausentes no JSON não mudam.
create or replace function tarefas.update_card(p_card uuid, p_fields jsonb, p_expected_version int)
returns tarefas.cards language plpgsql security invoker set search_path = '' as $$
declare
  v_ws   uuid;
  v_card tarefas.cards;
begin
  -- Permissão antes do bloqueio: sob RLS, FOR UPDATE não enxerga linhas que o usuário não pode alterar.
  select workspace_id into v_ws from tarefas.cards where id = p_card;
  if v_ws is null then
    raise exception 'CARTAO_INEXISTENTE' using errcode = 'P0002';
  end if;
  if not tarefas.can_edit(v_ws) then
    raise exception 'SEM_PERMISSAO' using errcode = '42501';
  end if;
  select * into v_card from tarefas.cards where id = p_card for update;
  if v_card.version <> p_expected_version then
    raise exception 'CONFLITO' using errcode = 'P0001', detail = v_card.version::text;
  end if;
  update tarefas.cards set
    title       = case when p_fields ? 'title' then trim(p_fields ->> 'title') else title end,
    description = case when p_fields ? 'description' then nullif(trim(p_fields ->> 'description'), '') else description end,
    due_on      = case when p_fields ? 'due_on' then (p_fields ->> 'due_on')::date else due_on end,
    assignee_id = case when p_fields ? 'assignee_id' then (p_fields ->> 'assignee_id')::uuid else assignee_id end
  where id = p_card
  returning * into v_card;

  if p_fields ? 'label_ids' then
    delete from tarefas.card_labels where card_id = p_card;
    insert into tarefas.card_labels (workspace_id, card_id, label_id)
    select v_card.workspace_id, p_card, (x)::uuid
    from jsonb_array_elements_text(p_fields -> 'label_ids') x;
  end if;
  return v_card;
end $$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------

-- Cria convite e devolve o token (mostrado uma vez; só o hash fica no banco).
create or replace function tarefas.create_invite(p_ws uuid, p_email text, p_role tarefas.member_role)
returns text language plpgsql security definer set search_path = '' as $$
declare
  -- 244 bits aleatórios (duas UUID v4); só o hash SHA-256 é gravado.
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not tarefas.can_manage(p_ws) then
    raise exception 'SEM_PERMISSAO' using errcode = '42501';
  end if;
  if p_role = 'dono' or (p_role = 'admin' and tarefas.my_role(p_ws) <> 'dono') then
    raise exception 'PAPEL_INVALIDO' using errcode = '22023';
  end if;
  if exists (
    select 1 from tarefas.members m join auth.users u on u.id = m.user_id
    where m.workspace_id = p_ws and lower(u.email) = lower(trim(p_email))
  ) then
    raise exception 'JA_E_MEMBRO' using errcode = '22023';
  end if;
  delete from tarefas.invites where workspace_id = p_ws and email = lower(trim(p_email)) and accepted_at is null;
  insert into tarefas.invites (workspace_id, email, role, token_hash, invited_by)
  values (p_ws, lower(trim(p_email)), p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid());
  return v_token;
end $$;

-- Aceita convite: token válido, não expirado, não usado e destinado ao e-mail do usuário logado.
create or replace function tarefas.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_inv   tarefas.invites;
  v_email text;
begin
  if auth.uid() is null or not exists (select 1 from tarefas.profiles where id = auth.uid()) then
    raise exception 'NAO_AUTENTICADO' using errcode = '28000';
  end if;
  select * into v_inv from tarefas.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;
  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'CONVITE_INVALIDO' using errcode = 'P0002';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from v_inv.email then
    raise exception 'CONVITE_OUTRO_EMAIL' using errcode = '42501';
  end if;
  insert into tarefas.members (workspace_id, user_id, role)
  values (v_inv.workspace_id, auth.uid(), v_inv.role)
  on conflict (workspace_id, user_id) do nothing;
  update tarefas.invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.workspace_id;
end $$;

-- ---------------------------------------------------------------------------
-- Histórico de atividades e publicação em tempo real (triggers)
-- ---------------------------------------------------------------------------

create or replace function tarefas.publish(p_board uuid, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload || jsonb_build_object('by', auth.uid()), p_event,
                        'tarefas:board:' || p_board::text, true);
end $$;

create or replace function tarefas.on_card_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_row tarefas.cards := coalesce(new, old);
begin
  if tg_op = 'INSERT' then
    v_action := 'cartao_criado';
    v_details := jsonb_build_object('titulo', new.title);
  elsif tg_op = 'DELETE' then
    v_action := 'cartao_excluido';
    v_details := jsonb_build_object('titulo', old.title);
  elsif new.column_id is distinct from old.column_id then
    v_action := 'cartao_movido';
    v_details := jsonb_build_object('titulo', new.title,
      'de', (select name from tarefas.columns where id = old.column_id),
      'para', (select name from tarefas.columns where id = new.column_id));
  elsif new.title is distinct from old.title or new.description is distinct from old.description
     or new.due_on is distinct from old.due_on or new.assignee_id is distinct from old.assignee_id then
    v_action := 'cartao_editado';
    v_details := jsonb_build_object('titulo', new.title);
  end if;

  if v_action is not null then
    insert into tarefas.activity (workspace_id, board_id, card_id, actor_id, action, details)
    values (v_row.workspace_id, v_row.board_id, v_row.id, auth.uid(), v_action, v_details);
  end if;

  if tg_op = 'DELETE' then
    perform tarefas.publish(old.board_id, 'card_deleted', jsonb_build_object('id', old.id));
  else
    perform tarefas.publish(new.board_id, 'card_upsert', jsonb_build_object('card', to_jsonb(new)));
  end if;
  return null;
end $$;

create trigger cards_after_change after insert or update or delete on tarefas.cards
  for each row execute function tarefas.on_card_change();

create or replace function tarefas.on_card_labels_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_card tarefas.cards;
begin
  select * into v_card from tarefas.cards where id = coalesce(new.card_id, old.card_id);
  if v_card.id is not null then
    perform tarefas.publish(v_card.board_id, 'card_labels', jsonb_build_object('card_id', v_card.id));
  end if;
  return null;
end $$;

create trigger card_labels_after_change after insert or delete on tarefas.card_labels
  for each row execute function tarefas.on_card_labels_change();

create or replace function tarefas.on_column_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform tarefas.publish(old.board_id, 'column_deleted', jsonb_build_object('id', old.id));
  else
    perform tarefas.publish(new.board_id, 'column_upsert', jsonb_build_object('column', to_jsonb(new)));
    if tg_op = 'INSERT' then
      insert into tarefas.activity (workspace_id, board_id, actor_id, action, details)
      values (new.workspace_id, new.board_id, auth.uid(), 'coluna_criada', jsonb_build_object('nome', new.name));
    end if;
  end if;
  return null;
end $$;

create trigger columns_after_change after insert or update or delete on tarefas.columns
  for each row execute function tarefas.on_column_change();

create or replace function tarefas.on_comment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_card tarefas.cards;
begin
  select * into v_card from tarefas.cards where id = new.card_id;
  insert into tarefas.activity (workspace_id, board_id, card_id, actor_id, action, details)
  values (new.workspace_id, v_card.board_id, new.card_id, new.author_id, 'comentario',
          jsonb_build_object('titulo', v_card.title));
  perform tarefas.publish(v_card.board_id, 'comment_added',
                          jsonb_build_object('card_id', new.card_id, 'comment', to_jsonb(new)));
  return null;
end $$;

create trigger comments_after_insert after insert on tarefas.comments
  for each row execute function tarefas.on_comment_insert();

-- ---------------------------------------------------------------------------
-- Cadastro: perfil + espaço pessoal com quadro de exemplo
-- ---------------------------------------------------------------------------

create or replace function tarefas.setup_workspace(p_user uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_board uuid;
  v_todo uuid; v_doing uuid; v_done uuid;
  v_urgente uuid; v_bug uuid;
begin
  insert into tarefas.workspaces (name, created_by) values (p_name, p_user) returning id into v_ws;
  insert into tarefas.members (workspace_id, user_id, role) values (v_ws, p_user, 'dono');
  insert into tarefas.boards (workspace_id, name) values (v_ws, 'Projeto de exemplo') returning id into v_board;
  insert into tarefas.columns (workspace_id, board_id, name, position) values (v_ws, v_board, 'A fazer', 1024) returning id into v_todo;
  insert into tarefas.columns (workspace_id, board_id, name, position) values (v_ws, v_board, 'Fazendo', 2048) returning id into v_doing;
  insert into tarefas.columns (workspace_id, board_id, name, position) values (v_ws, v_board, 'Feito', 3072) returning id into v_done;
  insert into tarefas.labels (workspace_id, name, color) values (v_ws, 'Urgente', '#dc2626') returning id into v_urgente;
  insert into tarefas.labels (workspace_id, name, color) values (v_ws, 'Bug', '#7c3aed') returning id into v_bug;
  insert into tarefas.labels (workspace_id, name, color) values (v_ws, 'Melhoria', '#2563eb');
  insert into tarefas.cards (workspace_id, board_id, column_id, title, description, position, due_on, assignee_id, created_by) values
    (v_ws, v_board, v_todo, 'Definir escopo da primeira versão', 'Listar o essencial e o que fica para depois.', 1024, current_date + 3, p_user, p_user),
    (v_ws, v_board, v_todo, 'Revisar textos da página inicial', null, 2048, null, null, p_user),
    (v_ws, v_board, v_doing, 'Corrigir erro no formulário de contato', 'O botão fica desabilitado após um erro.', 1024, current_date + 1, p_user, p_user),
    (v_ws, v_board, v_done, 'Configurar repositório', null, 1024, null, p_user, p_user);
  insert into tarefas.card_labels (workspace_id, card_id, label_id)
    select v_ws, id, v_bug from tarefas.cards where board_id = v_board and title like 'Corrigir%';
  insert into tarefas.card_labels (workspace_id, card_id, label_id)
    select v_ws, id, v_urgente from tarefas.cards where board_id = v_board and title like 'Definir%';
  return v_ws;
end $$;

create or replace function tarefas.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if new.raw_user_meta_data ->> 'app' is distinct from 'tarefas' then
    return new;
  end if;
  v_name := left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100);
  if char_length(v_name) < 2 then v_name := 'Usuário'; end if;
  insert into tarefas.profiles (id, full_name) values (new.id, v_name);
  perform tarefas.setup_workspace(new.id, left('Espaço de ' || v_name, 80));
  return new;
end $$;

create trigger tarefas_on_auth_user_created
  after insert on auth.users
  for each row execute function tarefas.handle_new_user();

-- ---------------------------------------------------------------------------
-- Privilégios e RLS
-- ---------------------------------------------------------------------------

grant usage on schema tarefas to authenticated, service_role;
revoke all on all functions in schema tarefas from public;
revoke all on all tables in schema tarefas from anon, authenticated;

grant select on all tables in schema tarefas to authenticated;
grant update (name) on tarefas.workspaces to authenticated;
grant insert, update, delete on tarefas.boards, tarefas.columns, tarefas.labels, tarefas.card_labels to authenticated;
grant update (role) on tarefas.members to authenticated;
grant delete on tarefas.members, tarefas.invites, tarefas.cards to authenticated;
grant insert (workspace_id, card_id, author_id, body) on tarefas.comments to authenticated;
grant delete on tarefas.comments to authenticated;
-- Cartões: criação e edição só pelas funções (versão e posição); exclusão direta com RLS.
grant insert on tarefas.cards to authenticated;
grant update (title, description, due_on, assignee_id, column_id, position) on tarefas.cards to authenticated;
grant all on all tables in schema tarefas to service_role;

grant execute on function tarefas.my_role(uuid), tarefas.is_member(uuid), tarefas.can_edit(uuid), tarefas.can_manage(uuid),
  tarefas.can_access_topic(text), tarefas.position_after(uuid, uuid, uuid),
  tarefas.create_card(uuid, text, uuid), tarefas.move_card(uuid, uuid, uuid, int),
  tarefas.update_card(uuid, jsonb, int), tarefas.create_invite(uuid, text, tarefas.member_role),
  tarefas.accept_invite(text) to authenticated;
grant execute on function tarefas.setup_workspace(uuid, text) to service_role;

alter table tarefas.profiles    enable row level security;
alter table tarefas.workspaces  enable row level security;
alter table tarefas.members     enable row level security;
alter table tarefas.invites     enable row level security;
alter table tarefas.boards      enable row level security;
alter table tarefas.columns     enable row level security;
alter table tarefas.labels      enable row level security;
alter table tarefas.cards       enable row level security;
alter table tarefas.card_labels enable row level security;
alter table tarefas.comments    enable row level security;
alter table tarefas.activity    enable row level security;

-- Perfis: o próprio e os de quem divide algum espaço comigo (para nomes de responsáveis/autores).
create policy "perfis visíveis" on tarefas.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from tarefas.members a join tarefas.members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  )
);

create policy "membros leem" on tarefas.workspaces for select to authenticated using (tarefas.is_member(id));
create policy "dono renomeia" on tarefas.workspaces for update to authenticated
  using (tarefas.my_role(id) = 'dono') with check (tarefas.my_role(id) = 'dono');

create policy "membros leem" on tarefas.members for select to authenticated using (tarefas.is_member(workspace_id));
-- Só o dono muda papéis (e nunca para 'dono'); gerentes removem membros que não sejam o dono; todos podem sair.
create policy "dono altera papel" on tarefas.members for update to authenticated
  using (tarefas.my_role(workspace_id) = 'dono' and user_id <> auth.uid())
  with check (role <> 'dono');
create policy "remover membro" on tarefas.members for delete to authenticated using (
  role <> 'dono' and (user_id = auth.uid() or tarefas.can_manage(workspace_id))
);

create policy "gerentes leem convites" on tarefas.invites for select to authenticated using (tarefas.can_manage(workspace_id));
create policy "gerentes revogam convites" on tarefas.invites for delete to authenticated using (tarefas.can_manage(workspace_id));

create policy "membros leem" on tarefas.boards for select to authenticated using (tarefas.is_member(workspace_id));
create policy "gerentes escrevem" on tarefas.boards for all to authenticated
  using (tarefas.can_manage(workspace_id)) with check (tarefas.can_manage(workspace_id));

create policy "membros leem" on tarefas.columns for select to authenticated using (tarefas.is_member(workspace_id));
create policy "editores escrevem" on tarefas.columns for all to authenticated
  using (tarefas.can_edit(workspace_id)) with check (tarefas.can_edit(workspace_id));

create policy "membros leem" on tarefas.labels for select to authenticated using (tarefas.is_member(workspace_id));
create policy "gerentes escrevem" on tarefas.labels for all to authenticated
  using (tarefas.can_manage(workspace_id)) with check (tarefas.can_manage(workspace_id));

create policy "membros leem" on tarefas.cards for select to authenticated using (tarefas.is_member(workspace_id));
create policy "editores criam" on tarefas.cards for insert to authenticated with check (tarefas.can_edit(workspace_id));
create policy "editores alteram" on tarefas.cards for update to authenticated
  using (tarefas.can_edit(workspace_id)) with check (tarefas.can_edit(workspace_id));
create policy "editores excluem" on tarefas.cards for delete to authenticated using (tarefas.can_edit(workspace_id));

create policy "membros leem" on tarefas.card_labels for select to authenticated using (tarefas.is_member(workspace_id));
create policy "editores escrevem" on tarefas.card_labels for all to authenticated
  using (tarefas.can_edit(workspace_id)) with check (tarefas.can_edit(workspace_id));

create policy "membros leem" on tarefas.comments for select to authenticated using (tarefas.is_member(workspace_id));
create policy "editores comentam" on tarefas.comments for insert to authenticated
  with check (tarefas.can_edit(workspace_id) and author_id = auth.uid());
create policy "autor ou gerente exclui" on tarefas.comments for delete to authenticated
  using (author_id = auth.uid() or tarefas.can_manage(workspace_id));

create policy "membros leem" on tarefas.activity for select to authenticated using (tarefas.is_member(workspace_id));

-- Canal de tempo real: só membros do espaço do quadro recebem eventos e publicam presença.
create policy "tarefas: membros recebem eventos do quadro" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and tarefas.can_access_topic((select realtime.topic())));
create policy "tarefas: membros publicam presença no quadro" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('presence') and tarefas.can_access_topic((select realtime.topic())));
