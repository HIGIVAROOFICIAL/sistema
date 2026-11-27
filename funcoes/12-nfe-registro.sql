-- 27/11/2026: registro das NF-e de venda, permissão "Emitir NF-e" e aviso por e-mail ao dono a cada NF-e emitida ou cancelada.
-- O aviso sai do próprio banco (gatilho): quem emitir pelo sistema não tem como pular o e-mail.

-- 1) Permissão nova "emitir_nfe" (como "editar_produtos": só vale se o administrador marcar).
create or replace function public.tem_acesso(p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and access_status = 'liberado'
    and (role = 'admin'
      or (p_area not in ('editar_produtos', 'emitir_nfe') and (permissions is null or permissions ? p_area))
      or (p_area in ('editar_produtos', 'emitir_nfe') and permissions ? p_area)));
$$;

-- 2) Registro de cada NF-e (autorizada, rejeitada, cancelada).
create table if not exists public.nfe (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.sales(id) on delete set null,
  ambiente text not null default '2' check (ambiente in ('1', '2')),   -- 1 produção, 2 homologação (teste)
  serie int, numero int, chave text unique,
  status text not null check (status in ('autorizada', 'rejeitada', 'cancelada')),
  cstat text, motivo text, protocolo text,
  valor numeric, cliente text, cliente_doc text,
  emitida_por text, emitida_por_id uuid, emitida_em timestamptz not null default now(), dispositivo text,
  xml text,
  cancelada_por text, cancelada_por_id uuid, cancelada_em timestamptz, motivo_cancelamento text, protocolo_cancelamento text, xml_cancelamento text,
  aviso_emitida_em timestamptz, aviso_cancelada_em timestamptz
);
create index if not exists nfe_emitida_idx on public.nfe (emitida_em desc);
alter table public.nfe enable row level security;
drop policy if exists nfe_ler on public.nfe;
create policy nfe_ler on public.nfe for select to authenticated using (public.tem_acesso('emitir_nfe') or public.tem_acesso('vendas'));
revoke all on public.nfe from anon;
grant select on public.nfe to authenticated;     -- gravar só pelas funções abaixo
grant all on public.nfe to service_role;

-- 3) Gravar uma emissão (quem tem "Emitir NF-e").
create or replace function public.registrar_nfe(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id uuid;
begin
  if not public.tem_acesso('emitir_nfe') then raise exception 'sem permissão para emitir NF-e'; end if;
  select * into me from public.profiles where id = auth.uid();
  insert into public.nfe (sale_id, ambiente, serie, numero, chave, status, cstat, motivo, protocolo, valor, cliente, cliente_doc, emitida_por, emitida_por_id, dispositivo, xml)
  values (nullif(p->>'sale_id', '')::uuid, coalesce(p->>'ambiente', '2'), (p->>'serie')::int, (p->>'numero')::int, nullif(p->>'chave', ''),
          p->>'status', p->>'cstat', p->>'motivo', p->>'protocolo', (p->>'valor')::numeric, p->>'cliente', p->>'cliente_doc',
          me.full_name, me.id, left(p->>'dispositivo', 200), p->>'xml')
  returning id into v_id;
  return v_id;
end $$;

-- 4) Gravar um cancelamento (só nota autorizada).
create or replace function public.registrar_cancelamento_nfe(p_id uuid, p_motivo text, p_protocolo text, p_xml text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles; n public.nfe;
begin
  if not public.tem_acesso('emitir_nfe') then raise exception 'sem permissão para cancelar NF-e'; end if;
  select * into n from public.nfe where id = p_id for update;
  if n.id is null or n.status <> 'autorizada' then raise exception 'nota não encontrada ou não está autorizada'; end if;
  select * into me from public.profiles where id = auth.uid();
  update public.nfe set status = 'cancelada', cancelada_por = me.full_name, cancelada_por_id = me.id, cancelada_em = now(),
         motivo_cancelamento = p_motivo, protocolo_cancelamento = p_protocolo, xml_cancelamento = p_xml where id = p_id;
end $$;
grant execute on function public.registrar_nfe(jsonb), public.registrar_cancelamento_nfe(uuid, text, text, text) to authenticated;
revoke execute on function public.registrar_nfe(jsonb), public.registrar_cancelamento_nfe(uuid, text, text, text) from anon;

-- 5) Aviso por e-mail: o gatilho chama a função "boas-vindas" (ramo "nfe"), que lê a nota no banco e manda o e-mail.
create extension if not exists pg_net;
create or replace function public.aviso_nfe() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  if tg_op = 'INSERT' and new.status = 'autorizada' then ev := 'emitida';
  elsif tg_op = 'UPDATE' and new.status = 'cancelada' and old.status is distinct from 'cancelada' then ev := 'cancelada';
  else return new; end if;
  perform net.http_post(
    url := 'https://mhwilrexiplamaziufmm.supabase.co/functions/v1/boas-vindas',
    body := jsonb_build_object('tipo', 'nfe', 'id', new.id, 'evento', ev),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
end $$;
drop trigger if exists aviso_nfe on public.nfe;
create trigger aviso_nfe after insert or update of status on public.nfe for each row execute function public.aviso_nfe();

select 'ok' as resultado, (select count(*) from public.nfe) as notas;
