create table if not exists public.budget_state (
  id text primary key default 'shared',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.budget_state enable row level security;

drop policy if exists "budget_state_select_authenticated" on public.budget_state;
create policy "budget_state_select_authenticated"
on public.budget_state
for select
to authenticated
using (id = 'shared');

drop policy if exists "budget_state_insert_authenticated" on public.budget_state;
create policy "budget_state_insert_authenticated"
on public.budget_state
for insert
to authenticated
with check (id = 'shared');

drop policy if exists "budget_state_update_authenticated" on public.budget_state;
create policy "budget_state_update_authenticated"
on public.budget_state
for update
to authenticated
using (id = 'shared')
with check (id = 'shared');

create or replace function public.set_budget_state_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists budget_state_updated_at on public.budget_state;
create trigger budget_state_updated_at
before update on public.budget_state
for each row
execute function public.set_budget_state_updated_at();

insert into public.budget_state (id, data)
values ('shared', '{}'::jsonb)
on conflict (id) do nothing;
