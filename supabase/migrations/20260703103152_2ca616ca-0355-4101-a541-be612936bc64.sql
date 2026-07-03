
-- Role enum
do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null; end $$;

-- user_roles table
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "Roles readable by authenticated" on public.user_roles;
create policy "Roles readable by authenticated"
on public.user_roles for select
to authenticated
using (true);

-- has_role helper
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Allowlist grant function (verified email only)
create or replace function public.grant_admin_for_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and lower(new.email) in (
       'totallybro541@gmail.com',
       'ghadah_h_k@hotmail.com',
       'totallyfriend4@gmail.com',
       'totallyguestxd@gmail.com'
     ) then
    insert into public.user_roles (user_id, role)
    values (new.id, 'admin')
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_grant_admin on auth.users;
create trigger on_auth_user_created_grant_admin
after insert on auth.users
for each row execute function public.grant_admin_for_allowlist();

drop trigger if exists on_auth_user_confirmed_grant_admin on auth.users;
create trigger on_auth_user_confirmed_grant_admin
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.grant_admin_for_allowlist();

-- Backfill existing confirmed users on the allowlist
insert into public.user_roles (user_id, role)
select u.id, 'admin'::public.app_role
from auth.users u
where u.email_confirmed_at is not null
  and lower(u.email) in (
    'totallybro541@gmail.com',
    'ghadah_h_k@hotmail.com',
    'totallyfriend4@gmail.com',
    'totallyguestxd@gmail.com'
  )
on conflict (user_id, role) do nothing;
