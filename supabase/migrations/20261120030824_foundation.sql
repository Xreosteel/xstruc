-- X Struc foundation schema (architecture v2 §7, ADR-002 / 005 / 007).
-- Organisations (companies; XREO first), members with roles, projects, elements (a floor slab or a precast panel),
-- numbered model versions (engine inputs + engine version + output hash), approvals, drawings and an audit log.
-- Every table carries org_id and row-level security; rows link through (id, org_id) keys so nothing can point
-- across organisations. Approved versions are frozen. Privileged writes (approvals, status changes) are made by the
-- server with the service role after it has re-run the engine; the browser can never write them.

-- ---------------------------------------------------------------- types
create type public.member_role as enum ('owner', 'admin', 'approver', 'detailer', 'site', 'viewer');
create type public.element_kind as enum ('floor', 'panel');
create type public.version_status as enum ('draft', 'approved', 'issued', 'superseded');

-- ---------------------------------------------------------------- tables
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  short_name  text unique check (short_name ~ '^[a-z0-9-]{2,40}$'),
  created_at  timestamptz not null default now()
);

create table public.members (
  org_id      uuid not null references public.organisations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  job_number    text check (job_number is null or length(job_number) <= 40),
  site_address  text check (site_address is null or length(site_address) <= 300),
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, org_id)
);
create index projects_org_idx on public.projects (org_id, created_at desc);

create table public.elements (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  uuid not null,
  kind        public.element_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 120),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index elements_project_idx on public.elements (project_id);

create table public.model_versions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  element_id      uuid not null,
  number          integer not null,                       -- 1, 2, 3 … per element, set by the trigger below
  inputs          jsonb not null,                         -- the engine inputs (FloorInput / PanelInput)
  engine_version  text not null check (engine_version ~ '^\d+\.\d+\.\d+$'),
  output_hash     text not null check (output_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of canonicalOutput(model)
  summary         jsonb not null default '{}'::jsonb,     -- bars, marks, kg, warnings: for lists, never trusted
  status          public.version_status not null default 'draft',
  note            text check (note is null or length(note) <= 2000),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (element_id, number),
  unique (id, org_id),
  foreign key (element_id, org_id) references public.elements (id, org_id) on delete cascade
);

create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  version_id      uuid not null unique,
  approved_by     uuid not null references auth.users (id),
  approved_at     timestamptz not null default now(),
  engine_version  text not null,
  output_hash     text not null check (output_hash ~ '^[0-9a-f]{64}$'),
  note            text,
  foreign key (version_id, org_id) references public.model_versions (id, org_id) on delete restrict
);

create table public.drawings (                            -- Phase 3: uploaded sheets; files live in Storage
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  project_id    uuid not null,
  storage_path  text not null,                            -- '<org_id>/drawings/…' in the org-files bucket
  file_name     text not null,
  sheet         text,
  revision      text,
  uploaded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = org_id::text),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.organisations (id) on delete cascade,
  actor      uuid,
  action     text not null,                               -- INSERT / UPDATE / DELETE
  entity     text not null,                               -- table name
  entity_id  uuid,
  at         timestamptz not null default now(),
  detail     jsonb not null default '{}'::jsonb
);
create index audit_log_org_idx on public.audit_log (org_id, at desc);

-- ---------------------------------------------------------------- membership helpers
-- security definer so policies on members can ask about members without recursing through members' own policies
create function public.has_role(target_org uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.org_id = target_org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create function public.is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.org_id = target_org and m.user_id = (select auth.uid()));
$$;

-- the organisation a Storage object belongs to: the first folder of its path, if that is a uuid (else no one's)
create function public.folder_org(object_name text) returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(object_name, '/', 1)::uuid end;
$$;

-- the role sets of architecture v2 §7
create function public.can_write(target_org uuid) returns boolean language sql stable set search_path = '' as $$
  select public.has_role(target_org, array['owner', 'admin', 'approver', 'detailer']::public.member_role[]);
$$;
create function public.can_admin(target_org uuid) returns boolean language sql stable set search_path = '' as $$
  select public.has_role(target_org, array['owner', 'admin']::public.member_role[]);
$$;

-- a signed-in user starts an organisation and becomes its owner (the only way to create one from the browser)
create function public.create_organisation(org_name text, org_short_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.organisations (name, short_name) values (org_name, org_short_name) returning id into new_id;
  insert into public.members (org_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

-- ---------------------------------------------------------------- triggers
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

-- version numbers 1, 2, 3 … per element, never taken from the client
create function public.number_version() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.element_id::text, 0));
  select coalesce(max(v.number), 0) + 1 into new.number from public.model_versions v where v.element_id = new.element_id;
  return new;
end;
$$;
create trigger model_versions_number before insert on public.model_versions for each row execute function public.number_version();

-- approved means frozen (ADR-007): what was approved can never change, whoever asks
create function public.freeze_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (
       new.inputs is distinct from old.inputs or new.engine_version is distinct from old.engine_version
    or new.output_hash is distinct from old.output_hash or new.number is distinct from old.number
    or new.element_id is distinct from old.element_id or new.org_id is distinct from old.org_id) then
    raise exception 'version % is %, so it is frozen: save a new version instead', old.number, old.status
      using errcode = '42501';
  end if;
  if new.status in ('approved', 'issued') and old.status = 'draft'
     and not exists (select 1 from public.approvals a where a.version_id = new.id and a.output_hash = new.output_hash) then
    raise exception 'version % has no matching approval', old.number using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger model_versions_freeze before update on public.model_versions for each row execute function public.freeze_version();

-- audit log: who changed what, written by the database itself
create function public.audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; eid uuid; info jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  -- one statement per table shape: plpgsql fails on a field a row does not have, even in an untaken branch
  if tg_table_name = 'members' then
    eid := r.user_id; info := jsonb_build_object('role', r.role);
  elsif tg_table_name = 'model_versions' then
    eid := r.id; info := jsonb_build_object('number', r.number, 'status', r.status);
  else
    eid := r.id;
  end if;
  insert into public.audit_log (org_id, actor, action, entity, entity_id, detail)
  values (r.org_id, auth.uid(), tg_op, tg_table_name, eid, info);
  return null;
end;
$$;
create trigger projects_audit after insert or update or delete on public.projects for each row execute function public.audit();
create trigger elements_audit after insert or update or delete on public.elements for each row execute function public.audit();
create trigger model_versions_audit after insert or update or delete on public.model_versions for each row execute function public.audit();
create trigger approvals_audit after insert or update or delete on public.approvals for each row execute function public.audit();
create trigger members_audit after insert or update or delete on public.members for each row execute function public.audit();

-- ---------------------------------------------------------------- row-level security
alter table public.organisations  enable row level security;
alter table public.members        enable row level security;
alter table public.projects       enable row level security;
alter table public.elements       enable row level security;
alter table public.model_versions enable row level security;
alter table public.approvals      enable row level security;
alter table public.drawings       enable row level security;
alter table public.audit_log      enable row level security;

create policy "members read their organisations" on public.organisations for select to authenticated
  using (public.is_member(id));
create policy "owners and admins rename" on public.organisations for update to authenticated
  using (public.can_admin(id)) with check (public.can_admin(id));

create policy "members see who else is in" on public.members for select to authenticated
  using (public.is_member(org_id));
create policy "owners and admins add members" on public.members for insert to authenticated
  with check (public.can_admin(org_id) and (role <> 'owner' or public.has_role(org_id, array['owner']::public.member_role[])));
create policy "owners and admins change roles" on public.members for update to authenticated
  using (public.can_admin(org_id) and (role <> 'owner' or public.has_role(org_id, array['owner']::public.member_role[])))
  with check (public.can_admin(org_id) and (role <> 'owner' or public.has_role(org_id, array['owner']::public.member_role[])));
create policy "owners and admins remove members" on public.members for delete to authenticated
  using (public.can_admin(org_id) and (role <> 'owner' or public.has_role(org_id, array['owner']::public.member_role[])));

create policy "members read projects" on public.projects for select to authenticated using (public.is_member(org_id));
create policy "detailers create projects" on public.projects for insert to authenticated with check (public.can_write(org_id));
create policy "detailers edit projects" on public.projects for update to authenticated
  using (public.can_write(org_id)) with check (public.can_write(org_id));
create policy "admins delete projects" on public.projects for delete to authenticated using (public.can_admin(org_id));

create policy "members read elements" on public.elements for select to authenticated using (public.is_member(org_id));
create policy "detailers create elements" on public.elements for insert to authenticated with check (public.can_write(org_id));
create policy "detailers rename elements" on public.elements for update to authenticated
  using (public.can_write(org_id)) with check (public.can_write(org_id));
create policy "admins delete elements" on public.elements for delete to authenticated using (public.can_admin(org_id));

-- site and viewer roles see issued versions only; writers see every version
create policy "members read versions" on public.model_versions for select to authenticated
  using (public.can_write(org_id) or (public.is_member(org_id) and status in ('issued', 'superseded')));
create policy "detailers save drafts" on public.model_versions for insert to authenticated
  with check (public.can_write(org_id) and status = 'draft');
create policy "detailers edit drafts" on public.model_versions for update to authenticated
  using (public.can_write(org_id) and status = 'draft') with check (public.can_write(org_id) and status = 'draft');
create policy "detailers delete drafts" on public.model_versions for delete to authenticated
  using (public.can_write(org_id) and status = 'draft');

create policy "members read approvals" on public.approvals for select to authenticated using (public.is_member(org_id));
-- no insert / update / delete policy: only the server (service role) records approvals

create policy "members read drawings" on public.drawings for select to authenticated using (public.is_member(org_id));
create policy "detailers add drawings" on public.drawings for insert to authenticated with check (public.can_write(org_id));
create policy "admins delete drawings" on public.drawings for delete to authenticated using (public.can_admin(org_id));

create policy "owners and admins read the audit log" on public.audit_log for select to authenticated
  using (public.can_admin(org_id));

-- ---------------------------------------------------------------- grants (explicit; anon gets nothing)
revoke all on all tables in schema public from anon;
-- Supabase's default privileges give authenticated every right on new tables (TRUNCATE included, which row-level
-- security does not cover): take them back and grant exactly what the app needs
revoke all on all tables in schema public from authenticated;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on public.organisations, public.members, public.projects, public.elements,
  public.model_versions, public.drawings to authenticated;
grant select on public.approvals, public.audit_log to authenticated;
revoke insert, delete on public.organisations from authenticated;   -- create_organisation() is the way in
grant execute on function public.create_organisation(text, text), public.is_member(uuid), public.has_role(uuid, public.member_role[]),
  public.can_write(uuid), public.can_admin(uuid), public.folder_org(text) to authenticated;

-- ---------------------------------------------------------------- storage: one private bucket, a folder per organisation
insert into storage.buckets (id, name, public) values ('org-files', 'org-files', false) on conflict (id) do nothing;

create policy "members read their organisation's files" on storage.objects for select to authenticated
  using (bucket_id = 'org-files' and public.is_member(public.folder_org(name)));
create policy "detailers upload to their organisation's folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'org-files' and public.can_write(public.folder_org(name)));
create policy "admins delete their organisation's files" on storage.objects for delete to authenticated
  using (bucket_id = 'org-files' and public.can_admin(public.folder_org(name)));
