-- 拾光云同步初始结构。只新增拾光专用对象，不删除已有业务数据。
begin;

create table if not exists public.journal_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"version":1,"notes":[],"goals":[]}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint journal_document_shape check (
    jsonb_typeof(data) = 'object' and data->>'version' is not distinct from '1'
    and jsonb_typeof(data->'notes') is not distinct from 'array'
    and jsonb_typeof(data->'goals') is not distinct from 'array'
    and jsonb_array_length(data->'notes') <= 1000
    and jsonb_array_length(data->'goals') <= 1000
    and octet_length(data::text) <= 25000000
  )
);
create table if not exists public.journal_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  data jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, revision)
);

alter table public.journal_documents enable row level security;
alter table public.journal_versions enable row level security;
revoke all on public.journal_documents, public.journal_versions from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update on public.journal_documents to authenticated;
grant select, insert, delete on public.journal_versions to authenticated;

drop policy if exists journal_document_read_own on public.journal_documents;
create policy journal_document_read_own on public.journal_documents
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists journal_document_insert_own on public.journal_documents;
create policy journal_document_insert_own on public.journal_documents
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists journal_document_update_own on public.journal_documents;
create policy journal_document_update_own on public.journal_documents
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists journal_version_read_own on public.journal_versions;
create policy journal_version_read_own on public.journal_versions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists journal_version_insert_own on public.journal_versions;
create policy journal_version_insert_own on public.journal_versions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists journal_version_delete_own on public.journal_versions;
create policy journal_version_delete_own on public.journal_versions
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.journal_read_v1()
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.journal_documents%rowtype;
begin
  if v_user is null then raise exception '请先登录' using errcode = '28000'; end if;
  select * into v_row from public.journal_documents where user_id = v_user;
  if not found then
    return jsonb_build_object('revision',0,'data','{"version":1,"notes":[],"goals":[]}'::jsonb);
  end if;
  return jsonb_build_object('revision',v_row.revision,'data',v_row.data);
end;
$function$;

create or replace function public.journal_write_v1(p_revision bigint, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.journal_documents%rowtype;
begin
  if v_user is null then raise exception '请先登录' using errcode = '28000'; end if;
  if p_revision is null or p_revision < 0 or p_data is null
    or jsonb_typeof(p_data) <> 'object' or p_data->>'version' is distinct from '1'
    or jsonb_typeof(p_data->'notes') is distinct from 'array'
    or jsonb_typeof(p_data->'goals') is distinct from 'array'
  then raise exception '手账内容格式无效' using errcode = '22023'; end if;
  if jsonb_array_length(p_data->'notes') > 1000 or jsonb_array_length(p_data->'goals') > 1000
    or octet_length(p_data::text) > 25000000
  then raise exception '手账内容超过容量限制' using errcode = '22023'; end if;

  insert into public.journal_documents (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from public.journal_documents where user_id = v_user for update;
  if v_row.revision <> p_revision then
    return jsonb_build_object('ok',false,'revision',v_row.revision,'data',v_row.data);
  end if;
  if v_row.data = p_data then
    return jsonb_build_object('ok',true,'revision',v_row.revision,'data',v_row.data);
  end if;
  insert into public.journal_versions (user_id,revision,data)
    values (v_user,v_row.revision,v_row.data) on conflict do nothing;
  delete from public.journal_versions
    where user_id = v_user and revision < v_row.revision - 49;
  update public.journal_documents set data=p_data, revision=revision+1, updated_at=now()
    where user_id=v_user returning * into v_row;
  return jsonb_build_object('ok',true,'revision',v_row.revision,'data',v_row.data);
end;
$function$;
revoke all on function public.journal_read_v1() from public, anon, authenticated;
revoke all on function public.journal_write_v1(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.journal_read_v1() to authenticated;
grant execute on function public.journal_write_v1(bigint,jsonb) to authenticated;

commit;
