-- 27/11/2026: cadastro de produto completo (estilo ERP): dados, formação de preço por mark-up, tributos, códigos de barras e embalagens.
alter table public.products add column if not exists mfr_code text;          -- código do fabricante
alter table public.products add column if not exists pdv_description text;   -- descrição curta (PDV/cupom)
alter table public.products add column if not exists group_name text;
alter table public.products add column if not exists subgroup text;
alter table public.products add column if not exists class_name text;
alter table public.products add column if not exists last_supplier text;
alter table public.products add column if not exists last_purchase_price numeric;
alter table public.products add column if not exists unit_tax text;          -- unidade tributável
alter table public.products add column if not exists unit_multiple numeric;  -- múltiplo de venda
alter table public.products add column if not exists location text;
alter table public.products add column if not exists shelf text;
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists ncm text;
alter table public.products add column if not exists cest text;
alter table public.products add column if not exists origin text default '0';
alter table public.products add column if not exists cst text default '102';    -- CSOSN (Simples/MEI)
alter table public.products add column if not exists cfop text default '5102';
alter table public.products add column if not exists pricing jsonb;          -- percentuais da formação de preço
alter table public.products add column if not exists barcodes jsonb;         -- lista de códigos de barras
alter table public.products add column if not exists packages jsonb;         -- embalagens de venda [{unit, factor, ean, margin, price}]
-- A última compra passa a ser gravada pela entrada de nota.
create or replace function public.ultima_compra() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.product_id is not null then
    update public.products p set last_purchase_price = round(new.unit_cost / greatest(new.factor, 0.0001), 4),
      last_supplier = (select supplier_name from public.purchase_invoices where id = new.invoice_id) where p.id = new.product_id;
  end if;
  return new;
end $$;
drop trigger if exists ultima_compra on public.purchase_items;
create trigger ultima_compra after insert on public.purchase_items for each row execute function public.ultima_compra();
select count(*) produtos, count(*) filter (where active) ativos from public.products;
