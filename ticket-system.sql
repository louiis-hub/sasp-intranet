create extension if not exists pgcrypto;

create table if not exists public.ticket_panels (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null default '1500975724750704661',
  name text not null default 'Panneau tickets',
  channel_id text,
  message_id text,
  default_category_id text,
  component_type text not null default 'select' check (component_type in ('select', 'buttons')),
  title text not null default 'Contact Division / Unite',
  description text not null default '',
  image_url text,
  footer text default 'SASP - Ticketing',
  placeholder text default 'Fais un choix',
  log_channel_id text,
  transcript_channel_id text,
  max_tickets_per_user integer not null default 1,
  enabled boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_options (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid not null references public.ticket_panels(id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  emoji text default '🎫',
  category_id text,
  overflow_category_id text,
  archive_category_id text,
  support_role_ids text[] not null default '{}',
  manager_role_ids text[] not null default '{}',
  mention_role_ids text[] not null default '{}',
  required_role_ids text[] not null default '{}',
  blocked_role_ids text[] not null default '{}',
  channel_name_format text not null default 'ticket-{option}-{user}',
  welcome_title text,
  welcome_message text,
  color integer not null default 3066993,
  position integer not null default 0,
  max_tickets_per_user integer,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(panel_id, key)
);

create table if not exists public.ticket_tickets (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  panel_id uuid references public.ticket_panels(id) on delete set null,
  option_id uuid references public.ticket_options(id) on delete set null,
  channel_id text not null,
  ticket_number integer,
  requester_id text not null,
  requester_name text,
  status text not null default 'open' check (status in ('open', 'claimed', 'closed', 'archived')),
  claimed_by text,
  claimed_at timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text,
  close_reason text,
  transcript_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_questions (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.ticket_options(id) on delete cascade,
  label text not null,
  placeholder text,
  required boolean not null default false,
  input_type text not null default 'short' check (input_type in ('short', 'paragraph')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_answers (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.ticket_tickets(id) on delete cascade,
  question_id uuid references public.ticket_questions(id) on delete set null,
  label text not null,
  answer text,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_members (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.ticket_tickets(id) on delete cascade,
  user_id text not null,
  added_by text,
  created_at timestamptz not null default now(),
  unique(ticket_id, user_id)
);

create table if not exists public.ticket_logs (
  id uuid primary key default gen_random_uuid(),
  guild_id text,
  panel_id uuid references public.ticket_panels(id) on delete set null,
  option_id uuid references public.ticket_options(id) on delete set null,
  ticket_id uuid references public.ticket_tickets(id) on delete set null,
  action text not null,
  actor_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_blacklist (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  user_id text not null,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique(guild_id, user_id)
);

create index if not exists ticket_options_panel_idx on public.ticket_options(panel_id, position);
create index if not exists ticket_tickets_requester_idx on public.ticket_tickets(guild_id, requester_id, status);
create index if not exists ticket_logs_ticket_idx on public.ticket_logs(ticket_id, created_at desc);

alter table public.ticket_tickets add column if not exists ticket_number integer;
alter table public.ticket_tickets add column if not exists claimed_at timestamptz;

alter table public.ticket_panels enable row level security;
alter table public.ticket_options enable row level security;
alter table public.ticket_tickets enable row level security;
alter table public.ticket_questions enable row level security;
alter table public.ticket_answers enable row level security;
alter table public.ticket_members enable row level security;
alter table public.ticket_logs enable row level security;
alter table public.ticket_blacklist enable row level security;

drop policy if exists ticket_panels_auth_all on public.ticket_panels;
drop policy if exists ticket_options_auth_all on public.ticket_options;
drop policy if exists ticket_tickets_auth_all on public.ticket_tickets;
drop policy if exists ticket_questions_auth_all on public.ticket_questions;
drop policy if exists ticket_answers_auth_all on public.ticket_answers;
drop policy if exists ticket_members_auth_all on public.ticket_members;
drop policy if exists ticket_logs_auth_all on public.ticket_logs;
drop policy if exists ticket_blacklist_auth_all on public.ticket_blacklist;

create policy ticket_panels_auth_all on public.ticket_panels for all to authenticated using (true) with check (true);
create policy ticket_options_auth_all on public.ticket_options for all to authenticated using (true) with check (true);
create policy ticket_tickets_auth_all on public.ticket_tickets for all to authenticated using (true) with check (true);
create policy ticket_questions_auth_all on public.ticket_questions for all to authenticated using (true) with check (true);
create policy ticket_answers_auth_all on public.ticket_answers for all to authenticated using (true) with check (true);
create policy ticket_members_auth_all on public.ticket_members for all to authenticated using (true) with check (true);
create policy ticket_logs_auth_all on public.ticket_logs for all to authenticated using (true) with check (true);
create policy ticket_blacklist_auth_all on public.ticket_blacklist for all to authenticated using (true) with check (true);
