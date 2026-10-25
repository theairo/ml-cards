-- Денний ліміт нових карток і налаштування. Виконати один раз у Supabase: SQL Editor > New query > Run.
-- Міграція лише додає, наявні дані не змінює.

alter table progress add column if not exists first_seen date;   -- день, коли картку вперше побачено

-- Для карток, яких бачено рівно один раз, день першого перегляду відновлюємо з інтервалу
update progress
set first_seen = (due - iv * interval '1 day')::date
where first_seen is null and reps = 1;

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
alter table settings enable row level security;
drop policy if exists owner_all on settings;
create policy owner_all on settings for all to authenticated using (true) with check (true);
