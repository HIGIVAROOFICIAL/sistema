-- 27/11/2026: código interno automático, histórico de compras, regime tributário e padrões de preço,
-- observações e motivo de devolução na venda, painel da tela inicial.

-- 1) Código interno do produto: o sistema dá o próximo número (o usuário não digita).
create or replace function public.proximo_codigo_produto() returns text
language sql stable security definer set search_path = public as $$
  select (coalesce(max(code::bigint), 0) + 1)::text from public.products where code ~ '^[0-9]{1,15}$';
$$;
grant execute on function public.proximo_codigo_produto() to authenticated;
revoke execute on function public.proximo_codigo_produto() from anon;

create or replace function public.codigo_produto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or btrim(new.code) = '' then
    perform pg_advisory_xact_lock(7710);
    new.code := public.proximo_codigo_produto();
  end if;
  return new;
end $$;
drop trigger if exists codigo_produto on public.products;
create trigger codigo_produto before insert on public.products for each row execute function public.codigo_produto();

-- 2) Histórico de compras do produto (quem pode editar produtos vê, mesmo sem acesso às notas).
create or replace function public.historico_compras(p_product uuid)
returns table (data date, nota text, fornecedor text, quantidade numeric, unidade text, fator numeric, custo_nota numeric, custo_unidade numeric, lote text, validade date)
language sql stable security definer set search_path = public as $$
  select coalesce(n.issue_date, n.created_at::date), n.number, n.supplier_name, i.quantity, i.unit, i.factor, i.unit_cost,
         round(i.unit_cost / greatest(coalesce(i.factor, 1), 0.0001), 4), i.lot, i.expiry
  from public.purchase_items i join public.purchase_invoices n on n.id = i.invoice_id
  where i.product_id = p_product and (public.tem_acesso('editar_produtos') or public.tem_acesso('produtos'))
  order by n.created_at desc limit 50;
$$;
grant execute on function public.historico_compras(uuid) to authenticated;
revoke execute on function public.historico_compras(uuid) from anon;

-- 3) Regime tributário e padrões da formação de preço (Admin › Formação de preços).
alter table public.company_settings add column if not exists tax_regime text not null default 'MEI';
alter table public.company_settings add column if not exists pricing_defaults jsonb;

-- 4) Venda: observações (saem no PDF) e motivo da devolução (obrigatório).
alter table public.sales add column if not exists observations text;
alter table public.sales add column if not exists return_reason text;

create or replace function public.registrar_venda(p_quote uuid, p_forma text default null, p_pago boolean default false, p_vencimento date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.quotes; v_id uuid; bruto numeric; pct numeric; me public.profiles; hoje date := (now() at time zone 'America/Bahia')::date;
begin
  if not public.eh_liberado() then raise exception 'sem acesso'; end if;
  select * into q from public.quotes where id = p_quote for update;
  if q.id is null then raise exception 'orcamento nao encontrado'; end if;
  if q.status = 'vendido' then raise exception 'orcamento ja vendido'; end if;
  select * into me from public.profiles where id = auth.uid();
  select coalesce(sum(quantity * unit_price), 0) into bruto from public.quote_items where quote_id = q.id;
  pct := coalesce(q.discount_percent, 0);
  insert into public.sales (quote_id, quote_number, client_name, client_doc, client_phone, client_email, client_code,
                            employee_name, employee_id, discount_percent, gross_total, discount_total, total, items_count,
                            payment_method, payment_status, due_date, received_at, received_by, observations)
  values (q.id, q.number, q.client_name, q.client_doc, q.client_phone, q.client_email, q.client_code,
          me.full_name, me.id, pct, round(bruto, 2), round(bruto * pct / 100, 2), round(bruto - bruto * pct / 100, 2),
          (select count(*) from public.quote_items where quote_id = q.id),
          p_forma, case when p_pago then 'recebido' else 'aberto' end, coalesce(p_vencimento, hoje),
          case when p_pago then hoje end, case when p_pago then me.full_name end, nullif(q.observations, ''))
  returning id into v_id;
  insert into public.sale_items (sale_id, product_id, code, description, brand, unit, quantity, unit_price, discount_value, total)
  select v_id, product_id, code, description, brand, unit, quantity, unit_price,
         round(quantity * unit_price * pct / 100, 2), round(quantity * unit_price * (1 - pct / 100), 2)
  from public.quote_items where quote_id = q.id;
  update public.products p set stock = p.stock - i.quantity, updated_at = now()
  from public.quote_items i where i.quote_id = q.id and i.product_id = p.id;
  update public.quotes set status = 'vendido' where id = q.id;
  return v_id;
end $$;

drop function if exists public.devolver_venda(uuid);
create or replace function public.devolver_venda(p_sale uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales; me public.profiles;
begin
  if not public.tem_acesso('vendas') then raise exception 'sem acesso'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'explique o motivo da devolucao'; end if;
  select * into s from public.sales where id = p_sale for update;
  if s.id is null or s.status = 'devolvida' then raise exception 'venda nao encontrada ou ja devolvida'; end if;
  select * into me from public.profiles where id = auth.uid();
  update public.products p set stock = p.stock + i.quantity, updated_at = now()
  from public.sale_items i where i.sale_id = s.id and i.product_id = p.id;
  update public.sales set status = 'devolvida', returned_date = (now() at time zone 'America/Bahia')::date,
         returned_by_name = me.full_name, return_reason = btrim(p_motivo) where id = s.id;
  update public.quotes set status = 'finalizado' where id = s.quote_id;
end $$;
grant execute on function public.devolver_venda(uuid, text) to authenticated;
revoke execute on function public.devolver_venda(uuid, text) from anon;

-- 5) Painel da tela inicial: vencimentos de hoje (a receber / a pagar), atrasados, próximos 7 dias e validade dos lotes.
create or replace function public.painel_inicio() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare h date := (now() at time zone 'America/Bahia')::date; r jsonb := '{}'::jsonb;
begin
  if not public.eh_liberado() then raise exception 'sem acesso'; end if;
  if public.tem_acesso('vendas') or public.tem_acesso('financeiro') then
    r := r || jsonb_build_object(
      'receber_hoje', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'numero', number, 'cliente', client_name, 'valor', total, 'forma', payment_method) order by total desc)
                                from public.sales where status = 'confirmada' and payment_status = 'aberto' and due_date = h), '[]'::jsonb),
      'receber_atrasado', (select jsonb_build_object('n', count(*), 'valor', coalesce(sum(total), 0)) from public.sales where status = 'confirmada' and payment_status = 'aberto' and due_date < h),
      'receber_7d', (select jsonb_build_object('n', count(*), 'valor', coalesce(sum(total), 0)) from public.sales where status = 'confirmada' and payment_status = 'aberto' and due_date > h and due_date <= h + 7),
      'vendas_hoje', (select jsonb_build_object('n', count(*), 'valor', coalesce(sum(total), 0)) from public.sales where status = 'confirmada' and date = h));
  end if;
  if public.eh_admin() then
    r := r || jsonb_build_object(
      'pagar_hoje', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'descricao', description, 'fornecedor', supplier, 'valor', amount) order by amount desc)
                              from public.expenses where status = 'aberto' and due_date = h), '[]'::jsonb),
      'pagar_atrasado', (select jsonb_build_object('n', count(*), 'valor', coalesce(sum(amount), 0)) from public.expenses where status = 'aberto' and due_date < h),
      'pagar_7d', (select jsonb_build_object('n', count(*), 'valor', coalesce(sum(amount), 0)) from public.expenses where status = 'aberto' and due_date > h and due_date <= h + 7));
  end if;
  if public.tem_acesso('produtos') then
    r := r || jsonb_build_object(
      'validade', coalesce((select jsonb_agg(x order by x->>'validade') from (
          select jsonb_build_object('codigo', p.code, 'produto', p.description, 'lote', i.lot, 'validade', i.expiry, 'dias', i.expiry - h, 'estoque', p.stock) x
          from public.purchase_items i join public.products p on p.id = i.product_id
          where i.expiry is not null and p.stock > 0 and i.expiry <= h + 60 order by i.expiry limit 8) t), '[]'::jsonb),
      'validade_n', (select jsonb_build_object('vencidos', count(*) filter (where i.expiry < h), 'em30', count(*) filter (where i.expiry >= h and i.expiry <= h + 30), 'em60', count(*) filter (where i.expiry > h + 30 and i.expiry <= h + 60))
                     from public.purchase_items i join public.products p on p.id = i.product_id where i.expiry is not null and p.stock > 0 and i.expiry <= h + 60),
      'estoque_baixo', (select count(*) from public.products where active and stock <= 5));
  end if;
  return r;
end $$;
grant execute on function public.painel_inicio() to authenticated;
revoke execute on function public.painel_inicio() from anon;

select public.proximo_codigo_produto() proximo_codigo, (select count(*) from public.products) produtos;
