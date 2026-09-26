-- Run once in this project's Supabase SQL Editor, using its postgres account.
-- Re-running preserves existing teacher data. No student data is embedded here.
begin;

create or replace function public.teacher_snapshot_valid(p_snapshot jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record; class_item jsonb; student jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or octet_length(p_snapshot::text) > 900000 then return false; end if;
  for item in select * from jsonb_each(p_snapshot) loop
    if item.key not in ('teacher-dashboard-class-management-v1',
      'teacher-dashboard-timetable-v1', 'cycle-timetable-prototype-v4',
      'teacher-dashboard-scores-v1') or jsonb_typeof(item.value) <> 'object'
      then return false; end if;
    if item.key = 'teacher-dashboard-class-management-v1' then
      if jsonb_typeof(item.value->'classes') is distinct from 'array' then return false; end if;
      for class_item in select * from jsonb_array_elements(item.value->'classes') loop
        if jsonb_typeof(class_item) <> 'object'
          or jsonb_typeof(class_item->'id') is distinct from 'string'
          or jsonb_typeof(class_item->'name') is distinct from 'string'
          or jsonb_typeof(class_item->'students') is distinct from 'array' then return false; end if;
        for student in select * from jsonb_array_elements(class_item->'students') loop
          if jsonb_typeof(student) <> 'object'
            or jsonb_typeof(student->'id') is distinct from 'string'
            or jsonb_typeof(student->'name') is distinct from 'string' then return false; end if;
        end loop;
      end loop;
    elsif item.key = 'teacher-dashboard-scores-v1' then
      if jsonb_typeof(item.value->'entries') is distinct from 'array'
        or jsonb_typeof(item.value->'rules') is distinct from 'array'
        or jsonb_typeof(item.value->'plants') is distinct from 'object' then return false; end if;
    else
      if jsonb_typeof(item.value->'classes') is distinct from 'array'
        or jsonb_typeof(item.value->'lessons') is distinct from 'object'
        or exists (select 1 from jsonb_array_elements(item.value->'classes') c where jsonb_typeof(c) <> 'string')
        then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

create table if not exists public.teacher_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision uuid not null,
  snapshot jsonb not null check (public.teacher_snapshot_valid(snapshot)),
  updated_at timestamptz not null default now(),
  device text not null
);
create table if not exists public.teacher_workspace_versions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision uuid not null,
  parent_revision uuid,
  snapshot jsonb not null check (public.teacher_snapshot_valid(snapshot)),
  updated_at timestamptz not null default now(),
  device text not null,
  primary key (owner_id, revision)
);
create index if not exists teacher_versions_by_owner_time
  on public.teacher_workspace_versions(owner_id, updated_at desc);

alter table public.teacher_workspaces enable row level security;
alter table public.teacher_workspace_versions enable row level security;
drop policy if exists teacher_read_own_workspace on public.teacher_workspaces;
create policy teacher_read_own_workspace on public.teacher_workspaces for select
  to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists teacher_read_own_versions on public.teacher_workspace_versions;
create policy teacher_read_own_versions on public.teacher_workspace_versions for select
  to authenticated using ((select auth.uid()) = owner_id);
-- All writes go through the atomic version-checking RPC, including first creation.
revoke all on public.teacher_workspaces, public.teacher_workspace_versions from public, anon, authenticated;
grant select on public.teacher_workspaces, public.teacher_workspace_versions to authenticated;

create or replace function public.teacher_read_workspace()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row public.teacher_workspaces;
begin
  if v_owner is null then raise exception '請先登入教師帳戶。' using errcode = '42501'; end if;
  select * into v_row from public.teacher_workspaces where owner_id = v_owner;
  return jsonb_build_object('version', 1, 'owner_id', v_owner, 'workspace',
    case when v_row.owner_id is null then null else
      jsonb_build_object('revision',v_row.revision,'snapshot',v_row.snapshot,
        'updated_at',v_row.updated_at,'device',v_row.device) end);
end;
$$;

create or replace function public.teacher_save_workspace(
  p_expected_revision uuid, p_request_id uuid, p_snapshot jsonb, p_device text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid(); v_current public.teacher_workspaces;
  v_previous public.teacher_workspace_versions; v_now timestamptz := clock_timestamp();
begin
  if v_owner is null then raise exception '請先登入教師帳戶。' using errcode = '42501'; end if;
  if p_request_id is null or p_device is null or length(p_device) not between 1 and 128
    or not public.teacher_snapshot_valid(p_snapshot) then
    raise exception '共用資料格式不正確或超過 900 KB，修改仍保存在本機。' using errcode = '22023';
  end if;
  -- Per-owner transaction lock also covers the first insert, where no row exists.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  select * into v_previous from public.teacher_workspace_versions
    where owner_id = v_owner and revision = p_request_id;
  if found then
    if v_previous.snapshot is distinct from p_snapshot or v_previous.parent_revision is distinct from p_expected_revision then
      raise exception '同一寫入請求的內容不一致。' using errcode = '22023';
    end if;
    return jsonb_build_object('kind','saved','workspace',jsonb_build_object(
      'revision',v_previous.revision,'snapshot',v_previous.snapshot,
      'updated_at',v_previous.updated_at,'device',v_previous.device));
  end if;
  select * into v_current from public.teacher_workspaces where owner_id = v_owner;
  if v_current.revision is distinct from p_expected_revision then
    return jsonb_build_object('kind','conflict','workspace',
      case when v_current.owner_id is null then null else jsonb_build_object(
        'revision',v_current.revision,'snapshot',v_current.snapshot,
        'updated_at',v_current.updated_at,'device',v_current.device) end);
  end if;
  insert into public.teacher_workspaces(owner_id,revision,snapshot,updated_at,device)
    values(v_owner,p_request_id,p_snapshot,v_now,p_device)
    on conflict(owner_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,
      updated_at=excluded.updated_at,device=excluded.device;
  insert into public.teacher_workspace_versions(owner_id,revision,parent_revision,snapshot,updated_at,device)
    values(v_owner,p_request_id,p_expected_revision,p_snapshot,v_now,p_device);
  -- Bounded history avoids storing a full copy forever on a free project.
  delete from public.teacher_workspace_versions where owner_id = v_owner and revision in (
    select revision from public.teacher_workspace_versions where owner_id = v_owner
      order by updated_at desc, revision desc offset 50
  );
  return jsonb_build_object('kind','saved','workspace',jsonb_build_object(
    'revision',p_request_id,'snapshot',p_snapshot,'updated_at',v_now,'device',p_device));
end;
$$;

revoke all on function public.teacher_snapshot_valid(jsonb) from public, anon, authenticated;
revoke all on function public.teacher_read_workspace() from public, anon, authenticated;
revoke all on function public.teacher_save_workspace(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.teacher_read_workspace() to authenticated;
grant execute on function public.teacher_save_workspace(uuid,uuid,jsonb,text) to authenticated;
notify pgrst, 'reload schema';
commit;
