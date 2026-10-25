-- ML Cards: схема бази. Виконати один раз у Supabase: SQL Editor > New query > Run.
-- Доступ має лише авторизований користувач (один акаунт, реєстрацію в Authentication вимкнено).

create table if not exists nodes (
  id         text primary key,
  parent_id  text references nodes(id) on delete cascade,
  title      text not null,
  tier       text not null default 'mid' check (tier in ('core', 'mid', 'niche')),
  position   int  not null default 0
);

create table if not exists cards (
  id         text primary key,
  node_id    text references nodes(id) on delete set null,   -- null: нерозподілена картка
  type       text check (type is null or type ~ '^A[1-9]$'),
  depth      int  not null default 1 check (depth between 1 and 3),
  question   text not null,
  answer     text not null,
  requires   text[] not null default '{}',                   -- теми, чия перша картка (A1) має бути пройдена
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cards_node_idx on cards(node_id);

create table if not exists labs (
  id         text primary key,
  title      text not null,
  node_ids   text[] not null default '{}',                   -- теми, що зустрілись у лабі
  created_at timestamptz not null default now()
);

create table if not exists progress (
  card_id    text primary key references cards(id) on delete cascade,
  iv         double precision not null default 0,            -- інтервал до наступного повторення, дні
  reps       int not null default 0,
  due        timestamptz not null,
  first_seen date                                            -- день першого перегляду (денний ліміт нових карток)
);

create table if not exists settings (
  key        text primary key,
  value      jsonb not null
);

create table if not exists activity (
  day        date primary key,
  count      int not null default 0
);

-- Row Level Security: усе доступно лише ролі authenticated (єдиний акаунт власника)
alter table nodes    enable row level security;
alter table cards    enable row level security;
alter table labs     enable row level security;
alter table progress enable row level security;
alter table activity enable row level security;
alter table settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['nodes', 'cards', 'labs', 'progress', 'activity', 'settings'] loop
    execute format('drop policy if exists owner_all on %I', t);
    execute format('create policy owner_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
