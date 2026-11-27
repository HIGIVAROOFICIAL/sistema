-- 27/11/2026: configuração fiscal da NF-e (IE, endereço oficial, ambiente, série, próximo número).
alter table public.company_settings add column if not exists nfe_config jsonb;
select 'ok' as resultado;
