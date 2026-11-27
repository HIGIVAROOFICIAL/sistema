-- 27/11/2026: rascunho de NF-e (Prever = salva + espelho; Concluir = envia à SEFAZ).
alter table public.nfe drop constraint if exists nfe_status_check;
alter table public.nfe add constraint nfe_status_check check (status in ('rascunho', 'autorizada', 'rejeitada', 'cancelada'));
alter table public.nfe add column if not exists dados jsonb;   -- o que foi montado (venda, itens, destinatário, rodapé) para concluir depois

-- Salvar (ou atualizar) um rascunho.
create or replace function public.nfe_rascunho_salvar(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id uuid;
begin
  if not public.tem_acesso('emitir_nfe') then raise exception 'sem permissão para emitir NF-e'; end if;
  select * into me from public.profiles where id = auth.uid();
  if p_id is not null then
    update public.nfe set ambiente = coalesce(p->>'ambiente', ambiente), serie = (p->>'serie')::int, valor = (p->>'valor')::numeric, cliente = p->>'cliente', cliente_doc = p->>'cliente_doc',
           sale_id = nullif(p->>'sale_id', '')::uuid, xml = p->>'xml', dados = p->'dados', emitida_por = me.full_name, emitida_por_id = me.id, emitida_em = now(), dispositivo = left(p->>'dispositivo', 200)
     where id = p_id and status = 'rascunho' returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.nfe (sale_id, ambiente, serie, status, valor, cliente, cliente_doc, emitida_por, emitida_por_id, dispositivo, xml, dados, motivo)
  values (nullif(p->>'sale_id', '')::uuid, coalesce(p->>'ambiente', '1'), (p->>'serie')::int, 'rascunho', (p->>'valor')::numeric, p->>'cliente', p->>'cliente_doc',
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
    update public.nfe set sale_id = nullif(p->>'sale_id', '')::uuid, ambiente = coalesce(p->>'ambiente', ambiente), serie = (p->>'serie')::int, numero = (p->>'numero')::int, chave = nullif(p->>'chave', ''),
           status = 'autorizada', cstat = p->>'cstat', motivo = p->>'motivo', protocolo = p->>'protocolo', valor = (p->>'valor')::numeric, cliente = p->>'cliente', cliente_doc = p->>'cliente_doc',
           emitida_por = me.full_name, emitida_por_id = me.id, emitida_em = now(), dispositivo = left(p->>'dispositivo', 200), xml = p->>'xml'
     where id = r_id and status = 'rascunho' returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.nfe (sale_id, ambiente, serie, numero, chave, status, cstat, motivo, protocolo, valor, cliente, cliente_doc, emitida_por, emitida_por_id, dispositivo, xml)
  values (nullif(p->>'sale_id', '')::uuid, coalesce(p->>'ambiente', '1'), (p->>'serie')::int, (p->>'numero')::int, nullif(p->>'chave', ''),
          p->>'status', p->>'cstat', p->>'motivo', p->>'protocolo', (p->>'valor')::numeric, p->>'cliente', p->>'cliente_doc',
          me.full_name, me.id, left(p->>'dispositivo', 200), p->>'xml')
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.nfe_rascunho_salvar(uuid, jsonb), public.nfe_rascunho_excluir(uuid) to authenticated;
revoke execute on function public.nfe_rascunho_salvar(uuid, jsonb), public.nfe_rascunho_excluir(uuid) from anon;

-- Aviso por e-mail também quando um rascunho vira nota autorizada.
create or replace function public.aviso_nfe() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  if new.status = 'autorizada' and (tg_op = 'INSERT' or old.status is distinct from 'autorizada') then ev := 'emitida';
  elsif tg_op = 'UPDATE' and new.status = 'cancelada' and old.status is distinct from 'cancelada' then ev := 'cancelada';
  else return new; end if;
  perform net.http_post(
    url := 'https://mhwilrexiplamaziufmm.supabase.co/functions/v1/boas-vindas',
    body := jsonb_build_object('tipo', 'nfe', 'id', new.id, 'evento', ev),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
end $$;

-- Daqui em diante, só produção.
update public.company_settings set nfe_config = coalesce(nfe_config, '{}'::jsonb) || '{"ambiente": "1"}'::jsonb where id = 1;
select 'ok' resultado, nfe_config->>'ambiente' ambiente, nfe_config->>'proximo' proximo from public.company_settings where id = 1;
