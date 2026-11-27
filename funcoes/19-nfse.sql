-- 27/11/2026: NFS-e (nota de serviço, Sistema Nacional) na mesma tabela das NF-e, separada pela coluna "modelo".
alter table public.nfe add column if not exists modelo text not null default '55';
alter table public.nfe drop constraint if exists nfe_modelo_check;
alter table public.nfe add constraint nfe_modelo_check check (modelo in ('55', 'nfse'));
alter table public.nfe add column if not exists ndps int;   -- NFS-e: número da DPS (o nº da nota, nNFSe, vem do Sistema Nacional)
create index if not exists nfe_modelo_idx on public.nfe (modelo, emitida_em desc);

-- Salvar (ou atualizar) um rascunho.
create or replace function public.nfe_rascunho_salvar(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id uuid;
begin
  if not public.tem_acesso('emitir_nfe') then raise exception 'sem permissão para emitir NF-e'; end if;
  select * into me from public.profiles where id = auth.uid();
  if p_id is not null then
    update public.nfe set ndps = coalesce((p->>'ndps')::int, ndps), ambiente = coalesce(p->>'ambiente', ambiente), serie = (p->>'serie')::int, valor = (p->>'valor')::numeric, cliente = p->>'cliente', cliente_doc = p->>'cliente_doc',
           sale_id = nullif(p->>'sale_id', '')::uuid, xml = p->>'xml', dados = p->'dados', emitida_por = me.full_name, emitida_por_id = me.id, emitida_em = now(), dispositivo = left(p->>'dispositivo', 200)
     where id = p_id and status = 'rascunho' returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.nfe (modelo, ndps, sale_id, ambiente, serie, status, valor, cliente, cliente_doc, emitida_por, emitida_por_id, dispositivo, xml, dados, motivo)
  values (coalesce(p->>'modelo', '55'), (p->>'ndps')::int, nullif(p->>'sale_id', '')::uuid, coalesce(p->>'ambiente', '1'), (p->>'serie')::int, 'rascunho', (p->>'valor')::numeric, p->>'cliente', p->>'cliente_doc',
          me.full_name, me.id, left(p->>'dispositivo', 200), p->>'xml', p->'dados', 'Rascunho (espelho) – ainda não enviada à SEFAZ')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.nfe_rascunho_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tem_acesso('emitir_nfe') then raise exception 'sem permissão'; end if;
  delete from public.nfe where id = p_id and status = 'rascunho';
end $$;

-- Registrar o resultado do envio. Se veio de um rascunho: autorizada -> o rascunho vira a nota; rejeitada -> o rascunho guarda o motivo.
create or replace function public.registrar_nfe(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id uuid; r_id uuid := nullif(p->>'rascunho_id', '')::uuid;
begin
  if not public.tem_acesso('emitir_nfe') then raise exception 'sem permissão para emitir NF-e'; end if;
  select * into me from public.profiles where id = auth.uid();
  if r_id is not null and p->>'status' = 'rejeitada' then
    update public.nfe set cstat = p->>'cstat', motivo = 'Última tentativa recusada: ' || coalesce(p->>'motivo', '') where id = r_id and status = 'rascunho' returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  if r_id is not null and p->>'status' = 'autorizada' then
    update public.nfe set ndps = coalesce((p->>'ndps')::int, ndps), sale_id = nullif(p->>'sale_id', '')::uuid, ambiente = coalesce(p->>'ambiente', ambiente), serie = (p->>'serie')::int, numero = (p->>'numero')::int, chave = nullif(p->>'chave', ''),
           status = 'autorizada', cstat = p->>'cstat', motivo = p->>'motivo', protocolo = p->>'protocolo', valor = (p->>'valor')::numeric, cliente = p->>'cliente', cliente_doc = p->>'cliente_doc',
           emitida_por = me.full_name, emitida_por_id = me.id, emitida_em = now(), dispositivo = left(p->>'dispositivo', 200), xml = p->>'xml'
     where id = r_id and status = 'rascunho' returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.nfe (modelo, ndps, sale_id, ambiente, serie, numero, chave, status, cstat, motivo, protocolo, valor, cliente, cliente_doc, emitida_por, emitida_por_id, dispositivo, xml)
  values (coalesce(p->>'modelo', '55'), (p->>'ndps')::int, nullif(p->>'sale_id', '')::uuid, coalesce(p->>'ambiente', '1'), (p->>'serie')::int, (p->>'numero')::int, nullif(p->>'chave', ''),
          p->>'status', p->>'cstat', p->>'motivo', p->>'protocolo', (p->>'valor')::numeric, p->>'cliente', p->>'cliente_doc',
          me.full_name, me.id, left(p->>'dispositivo', 200), p->>'xml')
  returning id into v_id;
  return v_id;
end $$;

select 'ok' resultado, count(*) filter (where modelo = '55') nfe, count(*) filter (where modelo = 'nfse') nfse from public.nfe;
