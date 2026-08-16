-- ══════════════════════════════════════════════════════════════════
--  SASP INTRANET — Pointeuse : confirmations de service
--  À exécuter dans Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════════

alter table public.pointages
  add column if not exists discord_id text,
  add column if not exists clockout_reason text,
  add column if not exists total_duration_seconds integer,
  add column if not exists last_confirmation_at timestamptz,
  add column if not exists confirmation_count integer not null default 0,
  add column if not exists next_confirmation_at timestamptz,
  add column if not exists confirmation_requested_at timestamptz,
  add column if not exists confirmation_channel_id text,
  add column if not exists confirmation_message_id text;

update public.pointages
set next_confirmation_at = clock_in + interval '5 hours'
where clock_out is null
  and next_confirmation_at is null;

update public.pointages
set total_duration_seconds = greatest(0, extract(epoch from (clock_out - clock_in))::integer)
where clock_out is not null
  and total_duration_seconds is null;

create index if not exists idx_pointages_active_confirmation_due
  on public.pointages (clock_out, next_confirmation_at, confirmation_requested_at)
  where clock_out is null;

create index if not exists idx_pointages_discord_id
  on public.pointages (discord_id);
