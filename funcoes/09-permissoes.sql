-- 27/11/2026: permissões por área valendo no BANCO (não só na tela) + permissão "editar produtos e preços" + senha mínima 8.
-- Áreas: orcamentos, vendas, clientes, produtos, financeiro (sem lista definida = todas). "editar_produtos" só vale se marcada.
create or replace function public.tem_acesso(p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and access_status = 'liberado'
    and (role = 'admin' or (p_area <> 'editar_produtos' and (permissions is null or permissions ? p_area)) or (p_area = 'editar_produtos' and permissions ? 'editar_produtos')));
$$;
grant execute on function public.tem_acesso(text) to authenticated;

-- Remove as regras antigas (equipe inteira podia tudo) e cria por área.
do $$ declare t text; begin
  foreach t in array array['products','quotes','quote_items','quote_edit_logs','sales','sale_items','clients'] loop
    execute format('drop policy if exists equipe_ler on public.%I', t);
    execute format('drop policy if exists equipe_gravar on public.%I', t);
    execute format('drop policy if exists equipe_alterar on public.%I', t);
    execute format('drop policy if exists admin_apagar on public.%I', t);
    execute format('drop policy if exists area_ler on public.%I', t);
    execute format('drop policy if exists area_gravar on public.%I', t);
    execute format('drop policy if exists area_alterar on public.%I', t);
    execute format('drop policy if exists area_apagar on public.%I', t);
  end loop;
end $$;

-- Orçamentos (e itens/histórico): área Orçamentos.
create policy area_ler on public.quotes for select to authenticated using (public.tem_acesso('orcamentos') or public.tem_acesso('vendas'));
create policy area_gravar on public.quotes for insert to authenticated with check (public.tem_acesso('orcamentos'));
create policy area_alterar on public.quotes for update to authenticated using (public.tem_acesso('orcamentos'));
create policy area_apagar on public.quotes for delete to authenticated using (public.eh_admin());
create policy area_ler on public.quote_items for select to authenticated using (public.tem_acesso('orcamentos') or public.tem_acesso('vendas'));
create policy area_gravar on public.quote_items for insert to authenticated with check (public.tem_acesso('orcamentos'));
create policy area_alterar on public.quote_items for update to authenticated using (public.tem_acesso('orcamentos'));
create policy area_apagar on public.quote_items for delete to authenticated using (public.tem_acesso('orcamentos'));
create policy area_ler on public.quote_edit_logs for select to authenticated using (public.tem_acesso('orcamentos'));
create policy area_gravar on public.quote_edit_logs for insert to authenticated with check (public.tem_acesso('orcamentos'));

-- Vendas: área Vendas (o Financeiro também lê para o resumo). A venda em si é criada pela função registrar_venda.
create policy area_ler on public.sales for select to authenticated using (public.tem_acesso('vendas') or public.tem_acesso('financeiro'));
create policy area_alterar on public.sales for update to authenticated using (public.tem_acesso('vendas'));
create policy area_apagar on public.sales for delete to authenticated using (public.eh_admin());
create policy area_ler on public.sale_items for select to authenticated using (public.tem_acesso('vendas') or public.tem_acesso('financeiro'));
create policy area_apagar on public.sale_items for delete to authenticated using (public.eh_admin());

-- Clientes: área Clientes; quem faz orçamento também busca e cadastra cliente.
create policy area_ler on public.clients for select to authenticated using (public.tem_acesso('clientes') or public.tem_acesso('orcamentos'));
create policy area_gravar on public.clients for insert to authenticated with check (public.tem_acesso('clientes') or public.tem_acesso('orcamentos'));
create policy area_alterar on public.clients for update to authenticated using (public.tem_acesso('clientes') or public.tem_acesso('orcamentos'));
create policy area_apagar on public.clients for delete to authenticated using (public.eh_admin());

-- Produtos: consultar = Produtos, Orçamentos ou Vendas; cadastrar/alterar preço = "Editar produtos e preços"; excluir = admin.
create policy area_ler on public.products for select to authenticated using (public.tem_acesso('produtos') or public.tem_acesso('orcamentos') or public.tem_acesso('vendas'));
create policy area_gravar on public.products for insert to authenticated with check (public.tem_acesso('editar_produtos'));
create policy area_alterar on public.products for update to authenticated using (public.tem_acesso('editar_produtos'));
create policy area_apagar on public.products for delete to authenticated using (public.eh_admin());

-- Criar usuário e senha temporária: mínimo 8 caracteres.
create or replace function public.admin_senha_temporaria(p_user uuid, p_senha text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.eh_admin() then raise exception 'só o administrador pode redefinir senhas'; end if;
  if p_user = auth.uid() then raise exception 'para a sua própria senha, use "Esqueci a senha"'; end if;
  if length(coalesce(p_senha,'')) < 8 then raise exception 'a senha temporária precisa ter pelo menos 8 caracteres'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  update public.profiles set must_change_password = true where id = p_user;
end $$;
create or replace function public.admin_criar_usuario(p_nome text, p_email text, p_senha text, p_role text, p_perms jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text := lower(trim(p_email));
begin
  if not public.eh_admin() then raise exception 'só o administrador pode criar usuários'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if length(coalesce(p_senha,'')) < 8 then raise exception 'a senha temporária precisa ter pelo menos 8 caracteres'; end if;
  if exists (select 1 from auth.users where lower(email) = em) then raise exception 'já existe um usuário com este e-mail'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', upper(trim(p_nome))), now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (gen_random_uuid(), uid::text, uid, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now());
  update public.profiles set full_name = upper(trim(p_nome)), role = case when p_role = 'admin' then 'admin' else 'user' end, access_status = 'liberado', active = true,
         must_change_password = true, permissions = case when p_role = 'admin' then null else p_perms end where id = uid;
  return uid;
end $$;
select tablename, count(*) regras from pg_policies where schemaname = 'public' and tablename in ('products','quotes','quote_items','sales','sale_items','clients','quote_edit_logs') group by 1 order by 1;
