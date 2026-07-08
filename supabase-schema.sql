-- 마늘쫑 뽑기 월드 랭킹용 Supabase 스키마
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

create table if not exists public.garlic_rankings (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 10),
  cm numeric(8, 1) not null check (cm >= 0 and cm <= 3000),
  stage integer not null check (stage between 1 and 12),
  combo integer not null default 0 check (combo between 0 and 48),
  harvested integer not null default 0 check (harvested between 0 and 48),
  perfect_count integer not null default 0 check (perfect_count between 0 and 48),
  created_at timestamptz not null default now()
);

alter table public.garlic_rankings enable row level security;

drop policy if exists "Anyone can read garlic rankings" on public.garlic_rankings;
drop policy if exists "Anyone can submit garlic rankings" on public.garlic_rankings;

create policy "Anyone can read garlic rankings"
on public.garlic_rankings
for select
to anon
using (true);

create policy "Anyone can submit garlic rankings"
on public.garlic_rankings
for insert
to anon
with check (
  char_length(name) between 1 and 10
  and cm >= 0
  and cm <= 3000
  and stage between 1 and 12
  and combo between 0 and 48
  and harvested between 0 and 48
  and perfect_count between 0 and 48
);

grant select, insert on public.garlic_rankings to anon;

create index if not exists garlic_rankings_cm_idx
on public.garlic_rankings (cm desc, created_at asc);
