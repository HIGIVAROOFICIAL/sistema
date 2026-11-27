-- 27/11/2026: certificado A1 guardado criptografado no cofre do banco (Supabase Vault).
-- Só a função "nfe" do servidor (service_role) grava e lê; usuários do sistema e visitantes não têm acesso.
create extension if not exists supabase_vault;

create or replace function public.nfe_guardar_certificado(p_pfx text, p_senha text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v uuid;
begin
  select id into v from vault.secrets where name = 'nfe_pfx';
  if v is null then perform vault.create_secret(p_pfx, 'nfe_pfx', 'Certificado A1 da HIGIVARO (pfx em base64)');
  else perform vault.update_secret(v, p_pfx); end if;
  select id into v from vault.secrets where name = 'nfe_pfx_senha';
  if v is null then perform vault.create_secret(p_senha, 'nfe_pfx_senha', 'Senha do certificado A1 da HIGIVARO');
  else perform vault.update_secret(v, p_senha); end if;
end $$;

create or replace function public.nfe_ler_certificado() returns table (pfx text, senha text)
language sql security definer set search_path = public, vault as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'nfe_pfx'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'nfe_pfx_senha');
$$;

revoke all on function public.nfe_guardar_certificado(text, text) from public, anon, authenticated;
revoke all on function public.nfe_ler_certificado() from public, anon, authenticated;
grant execute on function public.nfe_guardar_certificado(text, text), public.nfe_ler_certificado() to service_role;

select 'ok' as resultado,
  has_function_privilege('authenticated', 'public.nfe_ler_certificado()', 'execute') as usuario_le,
  has_function_privilege('anon', 'public.nfe_ler_certificado()', 'execute') as visitante_le;
