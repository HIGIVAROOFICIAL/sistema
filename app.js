// Sistema HIGIVARO (26/11/2026): orçamentos, vendas, estoque e financeiro, com dados no Supabase.
const sb = supabase.createClient(HGV.url, HGV.chave);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const S = { user: null, perfil: null, empresa: null };

// ---------- utilidades ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });
const soDig = (v) => String(v || '').replace(/\D/g, '');
const limpaBusca = (t) => String(t || '').replace(/[,()%*\\]/g, ' ').trim();
function aviso(msg, erro = false) {
  const a = $('#aviso'); a.textContent = msg; a.className = erro ? 'erro' : ''; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), erro ? 6000 : 3000);
}
function falhou(e) { console.error(e); aviso('Erro: ' + (e?.message || e), true); }
async function ok(p) { const { data, error } = await p; if (error) throw error; return data; }
const ehAdmin = () => S.perfil?.role === 'admin';
const statusSelo = (s) => `<span class="selo ${esc(s)}">${esc(s)}</span>`;

// ---------- rotas ----------
const ROTAS = [
  [/^#\/o\/([\w-]+)$/, telaOrcamentoPublico, true],
  [/^#\/?$/, telaInicio],
  [/^#\/produtos$/, telaProdutos],
  [/^#\/orcamento\/novo$/, () => telaEditorOrcamento(null)],
  [/^#\/orcamento\/([\w-]+)\/editar$/, (id) => telaEditorOrcamento(id)],
  [/^#\/orcamento\/([\w-]+)$/, telaOrcamento],
  [/^#\/orcamentos$/, telaOrcamentos],
  [/^#\/vendas$/, telaVendas],
  [/^#\/venda\/([\w-]+)$/, telaVenda],
  [/^#\/financeiro$/, telaFinanceiro],
  [/^#\/admin$/, telaAdmin],
];
async function rotear() {
  const h = location.hash || '#/';
  for (const [re, fn, publica] of ROTAS) {
    const m = h.match(re);
    if (!m) continue;
    if (publica) { $('#topo').hidden = true; return fn(m[1]).catch(falhou); }
    if (!(await garantirAcesso())) return;
    montarMenu(h);
    app.innerHTML = '<p class="carregando">Carregando…</p>';
    return fn(m[1]).catch(falhou);
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', rotear);

function montarMenu(h) {
  $('#topo').hidden = false;
  const itens = [['#/', 'Início'], ['#/orcamento/novo', 'Novo orçamento'], ['#/orcamentos', 'Orçamentos'], ['#/vendas', 'Vendas'], ['#/produtos', 'Produtos'], ['#/financeiro', 'Financeiro']];
  if (ehAdmin()) itens.push(['#/admin', 'Admin']);
  $('#menu').innerHTML = itens.map(([href, t]) => `<a href="${href}" class="${h === href ? 'ativo' : ''}">${t}</a>`).join('');
}
$('#sair').onclick = async () => { await sb.auth.signOut(); S.user = S.perfil = null; location.hash = '#/'; rotear(); };

// ---------- login ----------
async function garantirAcesso() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { telaLogin(); return false; }
  S.user = session.user;
  if (!S.perfil || S.perfil.id !== S.user.id) {
    S.perfil = await ok(sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle());
  }
  if (!S.perfil || !S.perfil.active || S.perfil.access_status !== 'liberado') {
    $('#topo').hidden = false; $('#menu').innerHTML = '';
    app.innerHTML = `<div class="card auth"><h1>Aguardando liberação</h1><p>Seu cadastro (${esc(S.user.email)}) foi recebido. O administrador da HIGIVARO precisa liberar o seu acesso.</p><button class="btn" onclick="location.reload()">Já fui liberado</button></div>`;
    return false;
  }
  if (S.perfil.must_change_password) { telaTrocarSenha(true); return false; }
  if (!S.empresa) S.empresa = await ok(sb.from('company_settings').select('*').eq('id', 1).maybeSingle());
  return true;
}

function telaLogin(modo = 'entrar') {
  $('#topo').hidden = true;
  const titulo = { entrar: 'Entrar', cadastro: 'Criar acesso', esqueci: 'Recuperar senha' }[modo];
  app.innerHTML = `<div class="auth"><div class="logo"><img src="logo.png" alt="HIGIVARO"></div>
  <div class="card"><h1>${titulo}</h1><form id="f">
    ${modo === 'cadastro' ? '<label>Seu nome</label><input name="nome" required>' : ''}
    <label>E-mail</label><input name="email" type="email" required autocomplete="email">
    ${modo !== 'esqueci' ? `<label>Senha</label><input name="senha" type="password" minlength="6" required autocomplete="${modo === 'cadastro' ? 'new-password' : 'current-password'}">` : ''}
    <div class="acoes"><button class="btn pri grande">${titulo}</button></div></form>
    <div class="acoes">
      ${modo !== 'entrar' ? '<a href="#" data-m="entrar">Já tenho acesso</a>' : '<a href="#" data-m="cadastro">Criar acesso</a> · <a href="#" data-m="esqueci">Esqueci a senha</a>'}
    </div></div></div>`;
  $$('[data-m]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); telaLogin(a.dataset.m); }));
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); const b = $('#f button'); b.disabled = true;
    try {
      if (modo === 'entrar') { await ok(sb.auth.signInWithPassword({ email: f.email, password: f.senha })); rotear(); }
      if (modo === 'cadastro') {
        const r = await ok(sb.auth.signUp({ email: f.email, password: f.senha, options: { data: { full_name: f.nome }, emailRedirectTo: location.origin + location.pathname } }));
        if (r.session) rotear(); else app.innerHTML = '<div class="card auth"><h1>Confira seu e-mail</h1><p>Enviamos um link de confirmação. Depois de confirmar, entre com seu e-mail e senha.</p><a class="btn" href="#/">Voltar</a></div>';
      }
      if (modo === 'esqueci') {
        await ok(sb.auth.resetPasswordForEmail(f.email, { redirectTo: location.origin + location.pathname }));
        aviso('Se o e-mail estiver cadastrado, chegará um link para criar nova senha.');
      }
    } catch (err) { falhou(err.message === 'Invalid login credentials' ? 'e-mail ou senha incorretos' : err); }
    b.disabled = false;
  };
}

function telaTrocarSenha(obrigatoria) {
  $('#topo').hidden = !obrigatoria;
  app.innerHTML = `<div class="auth card"><h1>Criar nova senha</h1><form id="f"><label>Nova senha</label><input name="s1" type="password" minlength="6" required autocomplete="new-password"><label>Repita a senha</label><input name="s2" type="password" minlength="6" required autocomplete="new-password"><div class="acoes"><button class="btn pri grande">Salvar senha</button></div></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.s1 !== f.s2) return aviso('As senhas não são iguais.', true);
    try {
      await ok(sb.auth.updateUser({ password: f.s1 }));
      await ok(sb.rpc('atualizar_meu_perfil', { p_nome: null, p_senha_trocada: true }));
      S.perfil = null; aviso('Senha salva.'); location.hash = '#/'; rotear();
    } catch (err) { falhou(err); }
  };
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') telaTrocarSenha(false); });

// ---------- início ----------
async function telaInicio() {
  const mes = hoje().slice(0, 7);
  const [orc, ven] = await Promise.all([
    ok(sb.from('quotes').select('id', { count: 'exact', head: true }).neq('status', 'vendido')),
    ok(sb.from('sales').select('total').eq('status', 'confirmada').gte('date', mes + '-01')),
  ]).catch(() => [null, []]);
  const fat = (ven || []).reduce((s, v) => s + Number(v.total), 0);
  app.innerHTML = `<h1>Olá, ${esc(S.perfil.full_name || '')}</h1>
  <a class="btn pri grande" href="#/orcamento/novo">＋ Novo orçamento</a>
  <div class="grade" style="margin-top:14px">
    <a class="kpi" href="#/financeiro" style="text-decoration:none;color:inherit"><small>Vendas do mês</small><strong>${brl(fat)}</strong></a>
    <a class="kpi" href="#/orcamentos" style="text-decoration:none;color:inherit"><small>Orçamentos em aberto</small><strong>${S.orcAbertos ?? ''}</strong></a>
  </div>
  <div class="grade" style="margin-top:14px">
    <a class="btn" href="#/produtos">Consultar produtos</a><a class="btn" href="#/orcamentos">Orçamentos gerados</a><a class="btn" href="#/vendas">Vendas</a>
  </div>`;
  const { count } = await sb.from('quotes').select('id', { count: 'exact', head: true }).neq('status', 'vendido');
  $$('.kpi strong')[1].textContent = count ?? 0;
}

// ---------- produtos ----------
async function buscarProdutos(t, limite = 30) {
  let q = sb.from('products').select('*').order('description').limit(limite);
  t = limpaBusca(t);
  if (t) q = q.or(`description.ilike.%${t}%,code.ilike.%${t}%,brand.ilike.%${t}%`);
  return ok(q);
}
async function telaProdutos() {
  app.innerHTML = `<h1>Produtos</h1>
  <div class="linha"><input id="busca" placeholder="Buscar por descrição, código ou marca"></div>
  ${ehAdmin() ? `<div class="acoes"><button class="btn azul" id="novo">＋ Produto</button><label class="btn" style="margin:0">Importar planilha (CSV)<input type="file" id="csv" accept=".csv,text/csv" hidden></label></div>` : ''}
  <div id="form"></div><div class="tabela" style="margin-top:12px"><table><thead><tr><th>Código</th><th>Descrição</th><th class="esconde-cel">Marca</th><th>Un.</th><th class="num">Estoque</th><th class="num">Preço</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  const carregar = async () => {
    const ps = await buscarProdutos($('#busca').value, 200);
    $('#lista').innerHTML = ps.map((p) => `<tr class="${ehAdmin() ? 'clica' : ''}" data-id="${p.id}"><td>${esc(p.code)}</td><td>${esc(p.description)}</td><td class="esconde-cel">${esc(p.brand)}</td><td>${esc(p.unit)}</td><td class="num" style="${p.stock <= 0 ? 'color:var(--red)' : ''}">${p.stock}</td><td class="num">${brl(p.price)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum produto.</td></tr>';
    if (ehAdmin()) $$('#lista tr[data-id]').forEach((tr) => (tr.onclick = () => formProduto(ps.find((p) => p.id === tr.dataset.id), carregar)));
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); };
  if (ehAdmin()) {
    $('#novo').onclick = () => formProduto(null, carregar);
    $('#csv').onchange = (e) => importarCsv(e.target.files[0], carregar);
  }
  carregar();
}
function formProduto(p, depois) {
  p = p || {};
  $('#form').innerHTML = `<div class="card"><h2>${p.id ? 'Editar' : 'Novo'} produto</h2><form id="fp"><div class="linha">
    <div><label>Código</label><input name="code" required value="${esc(p.code)}"></div>
    <div style="flex:3 1 260px"><label>Descrição</label><input name="description" required value="${esc(p.description)}"></div></div>
    <div class="linha"><div><label>Marca</label><input name="brand" value="${esc(p.brand)}"></div><div><label>Unidade</label><input name="unit" value="${esc(p.unit)}"></div>
    <div><label>Estoque</label><input name="stock" inputmode="decimal" value="${p.stock ?? 0}"></div><div><label>Preço (R$)</label><input name="price" inputmode="decimal" value="${String(p.price ?? 0).replace('.', ',')}"></div></div>
    <div class="acoes"><button class="btn pri">Salvar</button><button type="button" class="btn" id="cancela">Cancelar</button>${p.id ? '<button type="button" class="btn perigo" id="apaga">Excluir</button>' : ''}</div></form></div>`;
  $('#form').scrollIntoView({ behavior: 'smooth' });
  $('#cancela').onclick = () => ($('#form').innerHTML = '');
  if (p.id) $('#apaga').onclick = async () => { if (!confirm('Excluir este produto?')) return; try { await ok(sb.from('products').delete().eq('id', p.id)); $('#form').innerHTML = ''; depois(); } catch (e) { falhou(e); } };
  $('#fp').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const reg = { code: f.code.trim(), description: f.description.trim(), brand: f.brand.trim(), unit: f.unit.trim(), stock: num(f.stock), price: num(f.price), updated_at: new Date().toISOString() };
    try { await ok(p.id ? sb.from('products').update(reg).eq('id', p.id) : sb.from('products').insert(reg)); aviso('Produto salvo.'); $('#form').innerHTML = ''; depois(); } catch (err) { falhou(err); }
  };
}
// CSV com cabeçalho: codigo;descricao;marca;unidade;estoque;preco (aceita vírgula ou ponto e vírgula)
async function importarCsv(arq, depois) {
  if (!arq) return;
  const txt = (await arq.text()).replace(/^﻿/, '');
  const linhas = txt.split(/\r?\n/).filter((l) => l.trim());
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = linhas[0].toLowerCase().split(sep).map((c) => c.trim().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const col = (...nomes) => cab.findIndex((c) => nomes.some((n) => c.startsWith(n)));
  const ix = { code: col('cod'), description: col('desc', 'produto', 'nome'), brand: col('marca'), unit: col('un'), stock: col('estoque', 'qtd', 'quant'), price: col('preco', 'valor') };
  if (ix.code < 0 || ix.description < 0) return aviso('A planilha precisa das colunas "código" e "descrição".', true);
  const regs = linhas.slice(1).map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''))).filter((c) => c[ix.code]).map((c) => ({
    code: c[ix.code], description: c[ix.description], brand: ix.brand >= 0 ? c[ix.brand] : null, unit: ix.unit >= 0 ? c[ix.unit] : null,
    stock: ix.stock >= 0 ? num(c[ix.stock]) : 0, price: ix.price >= 0 ? num(String(c[ix.price]).replace(/R\$\s*/, '')) : 0, updated_at: new Date().toISOString(),
  }));
  try {
    for (let i = 0; i < regs.length; i += 500) await ok(sb.from('products').upsert(regs.slice(i, i + 500), { onConflict: 'code' }));
    aviso(regs.length + ' produtos importados/atualizados.'); depois();
  } catch (e) { falhou(e); }
}

// ---------- orçamento: editor ----------
async function telaEditorOrcamento(id) {
  let q = { client_name: '', client_doc: '', client_phone: '', client_email: '', observations: '', discount_percent: 0 }, itens = [];
  if (id) {
    q = await ok(sb.from('quotes').select('*').eq('id', id).single());
    if (q.status === 'vendido') { aviso('Orçamento já vendido não pode ser editado.', true); location.hash = '#/orcamento/' + id; return; }
    itens = await ok(sb.from('quote_items').select('*').eq('quote_id', id).order('description'));
  }
  app.innerHTML = `<h1>${id ? 'Editar orçamento nº ' + esc(q.number) : 'Novo orçamento'}</h1>
  <div class="card"><h2 style="margin-top:0">Cliente</h2><div class="linha">
    <div><label>CPF ou CNPJ <small id="docst"></small></label><input id="doc" value="${esc(q.client_doc)}" inputmode="numeric" placeholder="Só números"></div>
    <div style="flex:2 1 260px"><label>Nome / Razão social</label><input id="nome" value="${esc(q.client_name)}"></div></div>
    <div class="linha"><div><label>Telefone / WhatsApp</label><input id="fone" value="${esc(q.client_phone)}" inputmode="tel"></div><div><label>E-mail</label><input id="email" value="${esc(q.client_email)}" type="email"></div></div>
    <label>Observações</label><textarea id="obs">${esc(q.observations)}</textarea></div>
  <div class="card"><h2 style="margin-top:0">Produtos</h2><input id="bp" placeholder="Digite para buscar o produto (nome, código ou marca)"><div id="sug"></div>
    <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Produto</th><th>Qtd</th><th>Preço un.</th><th class="num">Total</th><th></th></tr></thead><tbody id="carrinho"></tbody></table></div>
    <div class="linha" style="margin-top:12px"><div><label>Desconto (%)</label><input id="desc" inputmode="decimal" value="${String(q.discount_percent || 0).replace('.', ',')}"></div><div class="total" id="tot"></div></div></div>
  <div class="acoes"><button class="btn pri grande" id="salvar">Salvar orçamento</button></div>`;

  const desenhar = () => {
    $('#carrinho').innerHTML = itens.map((i, n) => `<tr><td>${esc(i.description)}<br><small style="color:var(--muted)">${esc(i.code)} · ${esc(i.brand || '')} · ${esc(i.unit || '')}</small></td>
      <td><input class="qtd" data-n="${n}" data-c="quantity" inputmode="decimal" value="${String(i.quantity).replace('.', ',')}"></td>
      <td><input class="preco" data-n="${n}" data-c="unit_price" inputmode="decimal" value="${String(i.unit_price).replace('.', ',')}"></td>
      <td class="num">${brl(i.quantity * i.unit_price)}</td><td><button class="btn perigo" data-x="${n}" title="Remover">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum produto no orçamento.</td></tr>';
    $$('#carrinho input').forEach((inp) => (inp.onchange = () => { itens[inp.dataset.n][inp.dataset.c] = num(inp.value); desenhar(); }));
    $$('#carrinho [data-x]').forEach((b) => (b.onclick = () => { itens.splice(b.dataset.x, 1); desenhar(); }));
    const bruto = itens.reduce((s, i) => s + i.quantity * i.unit_price, 0), pct = num($('#desc').value);
    $('#tot').innerHTML = `<small style="font-weight:400;color:var(--muted)">${itens.length} itens · bruto ${brl(bruto)}${pct ? ' · desconto ' + pct + '%' : ''}</small><br>Total ${brl(bruto * (1 - pct / 100))}`;
  };
  $('#desc').oninput = desenhar;
  let t;
  $('#bp').oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = $('#bp').value; if (termo.trim().length < 2) return ($('#sug').innerHTML = '');
      const ps = await buscarProdutos(termo, 15);
      $('#sug').innerHTML = ps.length ? `<div class="sugestoes">${ps.map((p) => `<div data-id="${p.id}"><b>${esc(p.description)}</b><br><small>${esc(p.code)} · ${esc(p.brand || '')} · estoque ${p.stock} · ${brl(p.price)}</small></div>`).join('')}</div>` : '<p class="vazio">Nada encontrado.</p>';
      $$('#sug [data-id]').forEach((d) => (d.onclick = () => {
        const p = ps.find((x) => x.id === d.dataset.id);
        const ja = itens.find((i) => i.product_id === p.id);
        if (ja) ja.quantity += 1; else itens.push({ product_id: p.id, code: p.code, description: p.description, brand: p.brand, unit: p.unit, quantity: 1, unit_price: Number(p.price) });
        $('#bp').value = ''; $('#sug').innerHTML = ''; desenhar(); $('#bp').focus();
      }));
    }, 250);
  };
  // CNPJ: ao completar 14 números, busca sozinho os dados na Receita (BrasilAPI) e formata. CPF: só formata.
  let ultimoDoc = soDig(q.client_doc);
  $('#doc').oninput = async () => {
    const c = soDig($('#doc').value), st = $('#docst');
    if (c.length === 11) { $('#doc').value = c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); st.textContent = '· CPF'; return; }
    if (c.length !== 14) { st.textContent = ''; return; }
    $('#doc').value = c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (c === ultimoDoc) return; ultimoDoc = c;
    st.textContent = '· buscando…';
    try {
      const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + c); if (!r.ok) throw new Error('não encontrado');
      const d = await r.json();
      $('#nome').value = d.razao_social || d.nome_fantasia || '';
      let email = d.email, fone = d.ddd_telefone_1;
      // A BrasilAPI quase nunca traz o e-mail; a CNPJ.ws (pública) traz e-mail e telefone.
      if (!email || !fone) {
        try {
          const e = (await (await fetch('https://publica.cnpj.ws/cnpj/' + c)).json()).estabelecimento || {};
          email = email || e.email; fone = fone || (e.telefone1 ? (e.ddd1 || '') + e.telefone1 : '');
        } catch { /* segue só com a BrasilAPI */ }
      }
      if (email) $('#email').value = String(email).toLowerCase();
      if (fone) $('#fone').value = String(fone).replace(/\D/g, '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
      st.textContent = '· ' + (d.descricao_situacao_cadastral || 'encontrado').toLowerCase();
    } catch (e) { st.textContent = '· CNPJ não encontrado'; }
  };
  $('#salvar').onclick = async () => {
    if (!$('#nome').value.trim()) return aviso('Informe o nome do cliente.', true);
    if (!itens.length) return aviso('Adicione pelo menos um produto.', true);
    const b = $('#salvar'); b.disabled = true;
    const pct = num($('#desc').value), bruto = itens.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const reg = { client_name: $('#nome').value.trim(), client_doc: $('#doc').value.trim(), client_phone: $('#fone').value.trim(), client_email: $('#email').value.trim(), observations: $('#obs').value.trim(), discount_percent: pct, total: r2(bruto * (1 - pct / 100)), items_count: itens.length, status: 'finalizado' };
    try {
      let qid = id;
      if (id) { await ok(sb.from('quotes').update(reg).eq('id', id)); await ok(sb.from('quote_items').delete().eq('quote_id', id)); }
      else { const n = await ok(sb.from('quotes').insert({ ...reg, employee_name: S.perfil.full_name, employee_id: S.perfil.id }).select('id').single()); qid = n.id; }
      await ok(sb.from('quote_items').insert(itens.map((i) => ({ quote_id: qid, product_id: i.product_id, code: i.code, description: i.description, brand: i.brand, unit: i.unit, quantity: i.quantity, unit_price: i.unit_price, total: r2(i.quantity * i.unit_price) }))));
      if (id) await ok(sb.from('quote_edit_logs').insert({ quote_id: id, quote_number: q.number, editor_name: S.perfil.full_name, editor_id: S.perfil.id, total: reg.total, items_count: reg.items_count }));
      aviso('Orçamento salvo.'); location.hash = '#/orcamento/' + qid;
    } catch (e) { falhou(e); b.disabled = false; }
  };
  desenhar();
}

// ---------- orçamento: detalhe, lista ----------
async function telaOrcamento(id) {
  const [q, itens, logs] = await Promise.all([
    ok(sb.from('quotes').select('*').eq('id', id).single()),
    ok(sb.from('quote_items').select('*').eq('quote_id', id).order('description')),
    ok(sb.from('quote_edit_logs').select('*').eq('quote_id', id).order('created_at', { ascending: false })),
  ]);
  const venda = q.status === 'vendido' ? await ok(sb.from('sales').select('id,number').eq('quote_id', id).eq('status', 'confirmada').maybeSingle()) : null;
  const link = location.origin + location.pathname + '#/o/' + id;
  app.innerHTML = `<h1>Orçamento nº ${esc(q.number)} ${statusSelo(q.status)}</h1>
  <div class="card"><b>${esc(q.client_name)}</b> ${q.client_doc ? '· ' + esc(q.client_doc) : ''}<br>${esc(q.client_phone || '')} ${esc(q.client_email || '')}<br><small style="color:var(--muted)">${dataBR(q.date)} ${esc(q.time)} · por ${esc(q.employee_name || '')}</small>${q.observations ? `<p>${esc(q.observations)}</p>` : ''}</div>
  ${tabelaItens(itens, q.discount_percent)}
  <div class="acoes">
    <button class="btn azul" id="pdf">PDF do orçamento</button>
    <a class="btn" target="_blank" href="https://wa.me/${soDig(q.client_phone).length >= 10 ? '55' + soDig(q.client_phone).replace(/^55/, '') : ''}?text=${encodeURIComponent('Olá! Segue o orçamento nº ' + q.number + ' da HIGIVARO: ' + link)}">Enviar no WhatsApp</a>
    <button class="btn" id="copiar">Copiar link</button>
    ${q.status !== 'vendido' ? '<a class="btn" href="#/orcamento/' + id + '/editar">Editar</a><button class="btn pri" id="vender">Confirmar venda</button>' : venda ? `<a class="btn" href="#/venda/${venda.id}">Ver venda nº ${esc(venda.number)}</a>` : ''}
    ${ehAdmin() && q.status !== 'vendido' ? '<button class="btn perigo" id="apagar">Excluir</button>' : ''}
  </div>
  ${logs.length ? `<h2>Histórico de edições</h2><div class="card">${logs.map((l) => `${new Date(l.created_at).toLocaleString('pt-BR')} · ${esc(l.editor_name)} · ${brl(l.total)}`).join('<br>')}</div>` : ''}`;
  $('#pdf').onclick = () => pdfDocumento('ORÇAMENTO', q, itens).catch(falhou);
  $('#copiar').onclick = () => navigator.clipboard.writeText(link).then(() => aviso('Link copiado.'), () => prompt('Copie o link:', link));
  if ($('#vender')) $('#vender').onclick = () => confirmarVenda(q, itens);
  if ($('#apagar')) $('#apagar').onclick = async () => { if (!confirm('Excluir o orçamento nº ' + q.number + '?')) return; try { await ok(sb.from('quotes').delete().eq('id', id)); location.hash = '#/orcamentos'; } catch (e) { falhou(e); } };
}
function tabelaItens(itens, pct, comDesc = false) {
  const bruto = itens.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  return `<div class="tabela"><table><thead><tr><th class="esconde-cel">Código</th><th>Produto</th><th class="num">Qtd</th><th class="num">Preço</th><th class="num">Total</th></tr></thead><tbody>
  ${itens.map((i) => `<tr><td class="esconde-cel">${esc(i.code)}</td><td>${esc(i.description)}<br><small style="color:var(--muted)">${esc(i.brand || '')} ${esc(i.unit || '')}</small></td><td class="num">${i.quantity}</td><td class="num">${brl(i.unit_price)}</td><td class="num">${brl(Number(i.quantity) * Number(i.unit_price))}</td></tr>`).join('')}
  </tbody></table></div><p class="total">${pct ? `<small style="font-weight:400">Bruto ${brl(bruto)} · desconto ${pct}% (−${brl(bruto * pct / 100)})</small><br>` : ''}Total ${brl(bruto * (1 - (pct || 0) / 100))}</p>`;
}
async function confirmarVenda(q, itens) {
  const ids = itens.map((i) => i.product_id).filter(Boolean);
  const ps = ids.length ? await ok(sb.from('products').select('id,stock,description').in('id', ids)) : [];
  const falta = itens.filter((i) => { const p = ps.find((x) => x.id === i.product_id); return p && Number(i.quantity) > Number(p.stock); });
  const msg = 'Confirmar a venda do orçamento nº ' + q.number + ' (' + brl(q.total) + ')?\nO estoque será baixado.' + (falta.length ? '\n\nATENÇÃO, estoque insuficiente:\n' + falta.map((i) => '• ' + i.description).join('\n') : '');
  if (!confirm(msg)) return;
  try { const vid = await ok(sb.rpc('registrar_venda', { p_quote: q.id })); aviso('Venda registrada.'); location.hash = '#/venda/' + vid; } catch (e) { falhou(e); }
}
async function telaOrcamentos() {
  app.innerHTML = `<h1>Orçamentos</h1><div class="linha"><input id="busca" placeholder="Buscar cliente ou número"><select id="st" style="flex:0 1 180px"><option value="">Todos</option><option>finalizado</option><option>vendido</option><option>rascunho</option></select></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Nº</th><th>Cliente</th><th class="esconde-cel">Data</th><th class="esconde-cel">Vendedor</th><th class="num">Total</th><th>Status</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  const carregar = async () => {
    let qy = sb.from('quotes').select('*').order('created_at', { ascending: false }).limit(200);
    const t = limpaBusca($('#busca').value); if (t) qy = qy.or(`client_name.ilike.%${t}%,number.ilike.%${t}%`);
    if ($('#st').value) qy = qy.eq('status', $('#st').value);
    const qs = await ok(qy);
    $('#lista').innerHTML = qs.map((q) => `<tr class="clica" onclick="location.hash='#/orcamento/${q.id}'"><td>${esc(q.number)}</td><td>${esc(q.client_name)}</td><td class="esconde-cel">${dataBR(q.date)}</td><td class="esconde-cel">${esc(q.employee_name || '')}</td><td class="num">${brl(q.total)}</td><td>${statusSelo(q.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum orçamento.</td></tr>';
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); }; $('#st').onchange = carregar; carregar();
}

// ---------- vendas ----------
async function telaVendas() {
  app.innerHTML = `<h1>Vendas</h1><div class="linha"><input id="busca" placeholder="Buscar cliente ou número"><input id="mes" type="month" value="${hoje().slice(0, 7)}" style="flex:0 1 180px"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Nº</th><th>Cliente</th><th class="esconde-cel">Data</th><th class="esconde-cel">Vendedor</th><th class="num">Total</th><th>Status</th></tr></thead><tbody id="lista"></tbody></table></div><p class="total" id="soma"></p>`;
  const carregar = async () => {
    const m = $('#mes').value; let qy = sb.from('sales').select('*').order('created_at', { ascending: false }).limit(500);
    if (m) { const [y, mm] = m.split('-').map(Number); qy = qy.gte('date', m + '-01').lte('date', m + '-' + new Date(y, mm, 0).getDate()); }
    const t = limpaBusca($('#busca').value); if (t) qy = qy.or(`client_name.ilike.%${t}%,number.ilike.%${t}%`);
    const vs = await ok(qy);
    $('#lista').innerHTML = vs.map((v) => `<tr class="clica" onclick="location.hash='#/venda/${v.id}'"><td>${esc(v.number)}</td><td>${esc(v.client_name)}</td><td class="esconde-cel">${dataBR(v.date)}</td><td class="esconde-cel">${esc(v.employee_name || '')}</td><td class="num">${brl(v.total)}</td><td>${statusSelo(v.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma venda.</td></tr>';
    $('#soma').textContent = 'Total confirmado: ' + brl(vs.filter((v) => v.status === 'confirmada').reduce((s, v) => s + Number(v.total), 0));
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); }; $('#mes').onchange = carregar; carregar();
}
async function telaVenda(id) {
  const [v, itens] = await Promise.all([ok(sb.from('sales').select('*').eq('id', id).single()), ok(sb.from('sale_items').select('*').eq('sale_id', id).order('description'))]);
  app.innerHTML = `<h1>Venda nº ${esc(v.number)} ${statusSelo(v.status)}</h1>
  <div class="card"><b>${esc(v.client_name)}</b> ${v.client_doc ? '· ' + esc(v.client_doc) : ''}<br>${esc(v.client_phone || '')} ${esc(v.client_email || '')}<br><small style="color:var(--muted)">${dataBR(v.date)} ${esc(v.time)} · por ${esc(v.employee_name || '')} · orçamento nº <a href="#/orcamento/${v.quote_id}">${esc(v.quote_number)}</a></small>
  ${v.status === 'devolvida' ? `<p style="color:#9a6700">Devolvida em ${dataBR(v.returned_date)} por ${esc(v.returned_by_name || '')}</p>` : ''}</div>
  ${tabelaItens(itens, v.discount_percent)}
  <div class="acoes"><button class="btn azul" id="pdf">PDF da venda</button>${v.status === 'confirmada' ? '<button class="btn perigo" id="devolver">Registrar devolução</button>' : ''}</div>`;
  $('#pdf').onclick = () => pdfDocumento('PEDIDO DE VENDA', v, itens).catch(falhou);
  if ($('#devolver')) $('#devolver').onclick = async () => {
    if (!confirm('Registrar a devolução da venda nº ' + v.number + '? O estoque volta e a venda sai do financeiro.')) return;
    try { await ok(sb.rpc('devolver_venda', { p_sale: id })); aviso('Devolução registrada.'); telaVenda(id); } catch (e) { falhou(e); }
  };
}

// ---------- financeiro ----------
async function telaFinanceiro() {
  const mesAtual = hoje().slice(0, 7);
  app.innerHTML = `<h1>Financeiro</h1><div class="linha"><input id="mes" type="month" value="${mesAtual}" style="flex:0 1 200px"></div><div id="fin"></div>`;
  const carregar = async () => {
    const m = $('#mes').value || mesAtual; const [y, mm] = m.split('-').map(Number);
    const ini6 = new Date(y, mm - 6, 1).toLocaleDateString('sv-SE'); const fim = m + '-' + new Date(y, mm, 0).getDate();
    const vs = await ok(sb.from('sales').select('date,total,gross_total,discount_total,employee_name').eq('status', 'confirmada').gte('date', ini6).lte('date', fim).limit(10000));
    const doMes = vs.filter((v) => v.date.startsWith(m));
    const fat = doMes.reduce((s, v) => s + Number(v.total), 0), desc = doMes.reduce((s, v) => s + Number(v.discount_total), 0);
    const metaV = Number(S.empresa?.monthly_goal || 0), pctMeta = metaV ? Math.min(100, (fat / metaV) * 100) : 0;
    const meses = [...Array(6)].map((_, i) => { const d = new Date(y, mm - 6 + i, 1); const k = d.toLocaleDateString('sv-SE').slice(0, 7); return { k, rot: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), v: vs.filter((x) => x.date.startsWith(k)).reduce((s, x) => s + Number(x.total), 0) }; });
    const maior = Math.max(1, ...meses.map((x) => x.v));
    const porFunc = {}; doMes.forEach((v) => { const k = v.employee_name || '—'; porFunc[k] = porFunc[k] || { n: 0, t: 0 }; porFunc[k].n++; porFunc[k].t += Number(v.total); });
    $('#fin').innerHTML = `<div class="grade" style="margin-top:12px">
      <div class="kpi"><small>Faturamento</small><strong>${brl(fat)}</strong></div><div class="kpi"><small>Vendas</small><strong>${doMes.length}</strong></div>
      <div class="kpi"><small>Ticket médio</small><strong>${brl(doMes.length ? fat / doMes.length : 0)}</strong></div><div class="kpi"><small>Descontos dados</small><strong>${brl(desc)}</strong></div></div>
      <div class="card" style="margin-top:12px"><b>Meta do mês:</b> ${metaV ? brl(metaV) + ' · ' + pctMeta.toFixed(0) + '% atingido' : 'não definida (Admin › Empresa)'}<div class="meta" style="margin-top:8px"><i style="width:${pctMeta}%"></i></div></div>
      <div class="card"><b>Últimos 6 meses</b><div class="barras">${meses.map((x) => `<div><small>${x.v ? brl(x.v).replace(',00', '') : ''}</small><i style="height:${(x.v / maior) * 130}px"></i>${x.rot}</div>`).join('')}</div></div>
      <h2>Desempenho por vendedor</h2><div class="tabela"><table><thead><tr><th>Vendedor</th><th class="num">Vendas</th><th class="num">Total</th></tr></thead><tbody>
      ${Object.entries(porFunc).sort((a, b) => b[1].t - a[1].t).map(([k, x]) => `<tr><td>${esc(k)}</td><td class="num">${x.n}</td><td class="num">${brl(x.t)}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Sem vendas no mês.</td></tr>'}</tbody></table></div>`;
  };
  $('#mes').onchange = carregar; carregar();
}

// ---------- admin ----------
async function telaAdmin() {
  if (!ehAdmin()) { app.innerHTML = '<p class="vazio">Acesso restrito ao administrador.</p>'; return; }
  const [e, us] = await Promise.all([ok(sb.from('company_settings').select('*').eq('id', 1).single()), ok(sb.from('profiles').select('*').order('created_at'))]);
  const campo = (n, rot, extra = '') => `<div><label>${rot}</label><input name="${n}" value="${esc(e[n] ?? '')}" ${extra}></div>`;
  app.innerHTML = `<h1>Administração</h1>
  <div class="card"><h2 style="margin-top:0">Empresa</h2><form id="fe"><div class="linha">${campo('name', 'Nome')}${campo('cnpj', 'CNPJ')}</div><div class="linha">${campo('phone', 'Telefone')}${campo('email', 'E-mail')}</div>
  <div class="linha">${campo('address', 'Endereço')}${campo('monthly_goal', 'Meta mensal (R$)', 'inputmode="decimal"')}</div>
  <label>Texto padrão no rodapé do orçamento</label><textarea name="observations_text">${esc(e.observations_text || '')}</textarea>
  <div class="acoes"><button class="btn pri">Salvar empresa</button></div></form></div>
  <div class="card"><h2 style="margin-top:0">Usuários</h2><p style="color:var(--muted);margin-top:0">Novos usuários se cadastram em "Criar acesso" na tela de login e aparecem aqui para você liberar.</p>
  <div class="tabela"><table><thead><tr><th>Nome</th><th class="esconde-cel">E-mail</th><th>Acesso</th><th>Tipo</th><th>Ativo</th></tr></thead><tbody>
  ${us.map((u) => `<tr data-id="${u.id}"><td>${esc(u.full_name)}</td><td class="esconde-cel">${esc(u.email)}</td>
    <td><select data-c="access_status" ${u.id === S.perfil.id ? 'disabled' : ''}><option ${u.access_status === 'liberado' ? 'selected' : ''}>liberado</option><option ${u.access_status === 'aguardando' ? 'selected' : ''}>aguardando</option></select></td>
    <td><select data-c="role" ${u.id === S.perfil.id ? 'disabled' : ''}><option value="user" ${u.role === 'user' ? 'selected' : ''}>vendedor</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
    <td><input type="checkbox" data-c="active" ${u.active ? 'checked' : ''} ${u.id === S.perfil.id ? 'disabled' : ''} style="width:auto"></td></tr>`).join('')}
  </tbody></table></div></div>`;
  $('#fe').onsubmit = async (ev) => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); f.monthly_goal = num(f.monthly_goal);
    try { await ok(sb.from('company_settings').update(f).eq('id', 1)); S.empresa = { ...S.empresa, ...f }; aviso('Empresa salva.'); } catch (err) { falhou(err); }
  };
  $$('tr[data-id] [data-c]').forEach((el) => (el.onchange = async () => {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    try { await ok(sb.from('profiles').update({ [el.dataset.c]: v }).eq('id', el.closest('tr').dataset.id)); aviso('Usuário atualizado.'); } catch (err) { falhou(err); }
  }));
}

// ---------- orçamento público (link para o cliente) ----------
async function telaOrcamentoPublico(id) {
  const d = await ok(sb.rpc('orcamento_publico', { p_id: id }));
  if (!d?.quote) { app.innerHTML = '<p class="vazio">Orçamento não encontrado.</p>'; return; }
  const q = d.quote, c = d.company || {};
  app.innerHTML = `<div class="card" style="display:flex;gap:12px;align-items:center"><img src="logo.png" style="width:60px"><div><b>${esc(c.name || 'HIGIVARO')}</b><br><small>${esc(c.phone || '')} ${esc(c.email || '')}</small></div></div>
  <h1>Orçamento nº ${esc(q.number)}</h1><div class="card"><b>${esc(q.client_name)}</b><br><small>${dataBR(q.date)} · atendido por ${esc(q.employee_name || '')}</small>${q.observations ? `<p>${esc(q.observations)}</p>` : ''}</div>
  ${tabelaItens(d.items, q.discount_percent)}
  <div class="acoes"><button class="btn azul" id="pdf">Baixar PDF</button>${c.phone ? `<a class="btn pri" target="_blank" href="https://wa.me/55${soDig(c.phone).replace(/^55/, '')}?text=${encodeURIComponent('Olá! Quero fechar o orçamento nº ' + q.number)}">Fechar pelo WhatsApp</a>` : ''}</div>
  ${c.observations_text ? `<p style="color:var(--muted)">${esc(c.observations_text)}</p>` : ''}`;
  $('#pdf').onclick = () => pdfDocumento('ORÇAMENTO', q, d.items, c).catch(falhou);
}

// ---------- PDF ----------
let logoData;
async function carregarLogo() {
  if (logoData !== undefined) return logoData;
  try { const b = await (await fetch('logo.png')).blob(); logoData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); } catch { logoData = null; }
  return logoData;
}
// PDF profissional (orçamento e venda): cabeçalho azul com logo, quadro do cliente, tabela listrada, totais em destaque e rodapé com página.
async function pdfDocumento(titulo, doc, itens, empresa) {
  const c = empresa || S.empresa || {};
  const ehVenda = titulo !== 'ORÇAMENTO';
  const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await carregarLogo();
  const NAVY = [3, 35, 68], AZUL = [47, 134, 222], VERDE = [108, 197, 49], TINTA = [13, 42, 74], CINZA = [96, 114, 138], LINHA = [223, 231, 240], FUNDO = [244, 247, 251];
  const M = 12, L = 210 - M * 2, num = (v) => String(Number(v)).replace('.', ',');
  const cor = (fn, rgb) => pdf[fn](...rgb);
  const txt = (t, x, y, o = {}) => { pdf.setFont('helvetica', o.b ? 'bold' : 'normal'); pdf.setFontSize(o.s || 9); cor('setTextColor', o.c || TINTA); pdf.text(String(t ?? ''), x, y, o.a ? { align: o.a } : undefined); };
  const rotulo = (t, x, y) => txt(String(t).toUpperCase(), x, y, { s: 6.5, b: true, c: CINZA });

  // Cabeçalho
  cor('setFillColor', NAVY); pdf.rect(0, 0, 210, 40, 'F');
  cor('setFillColor', VERDE); pdf.rect(0, 40, 210, 1.4, 'F');
  if (logo) pdf.addImage(logo, 'PNG', M, 7, 26, 26);
  const xEmp = logo ? M + 31 : M;
  txt(c.name || 'HIGIVARO', xEmp, 15, { s: 18, b: true, c: [255, 255, 255] });
  txt('Distribuidora de produtos de limpeza e higiene', xEmp, 20.5, { s: 8.5, c: [170, 200, 230] });
  txt([c.cnpj && 'CNPJ ' + c.cnpj, c.phone].filter(Boolean).join('   •   '), xEmp, 26.5, { s: 8, c: [220, 232, 245] });
  txt([c.email, 'higivarooficial.github.io'].filter(Boolean).join('   •   '), xEmp, 31, { s: 8, c: [220, 232, 245] });
  if (c.address) txt(c.address, xEmp, 35.5, { s: 7.5, c: [170, 200, 230] });
  txt(ehVenda ? 'PEDIDO DE VENDA' : 'ORÇAMENTO', 210 - M, 15, { s: 15, b: true, c: [255, 255, 255], a: 'right' });
  txt('Nº ' + doc.number, 210 - M, 23, { s: 13, b: true, c: VERDE, a: 'right' });
  txt(`Emissão: ${dataBR(doc.date)}${doc.time ? ' às ' + doc.time : ''}`, 210 - M, 29.5, { s: 8, c: [220, 232, 245], a: 'right' });

  // Quadro do cliente
  let y = 48;
  cor('setFillColor', FUNDO); cor('setDrawColor', LINHA); pdf.setLineWidth(0.3); pdf.roundedRect(M, y, L, 31, 2.5, 2.5, 'FD');
  rotulo('Cliente', M + 5, y + 6);
  txt(doc.client_name || '—', M + 5, y + 11.5, { s: 11.5, b: true });
  const col = [M + 5, M + 62, M + 118];
  rotulo('CPF / CNPJ', col[0], y + 18); txt(doc.client_doc || '—', col[0], y + 22.5, { s: 9 });
  rotulo('Telefone', col[1], y + 18); txt(doc.client_phone || '—', col[1], y + 22.5, { s: 9 });
  rotulo('E-mail', col[2], y + 18); txt(pdf.splitTextToSize(String(doc.client_email || '—').toLowerCase(), 62)[0], col[2], y + 22.5, { s: 9 });
  const extra = ehVenda ? [['Vendedor', doc.employee_name || '—'], ['Orçamento de origem', doc.quote_number ? 'Nº ' + doc.quote_number : '—'], ['Situação', doc.status === 'devolvida' ? 'Devolvida' : 'Confirmada']]
    : [['Vendedor', doc.employee_name || '—'], ['Validade da proposta', '7 dias'], ['Itens', String(itens.length)]];
  extra.forEach(([r, v], k) => {
    rotulo(r, col[k], y + 27.5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); const w = pdf.getTextWidth(r.toUpperCase());
    txt(v, col[k] + w + 2, y + 27.5, { s: 7.5, b: true });
  });
  y += 37;

  // Tabela de itens
  const pct = Number(doc.discount_percent || 0);
  const bruto = itens.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  pdf.autoTable({
    startY: y, margin: { left: M, right: M, top: 22, bottom: 22 },
    head: [['#', 'Código', 'Descrição', 'Marca', 'Un.', 'Qtd', 'Unitário', 'Total']],
    body: itens.map((i, k) => [k + 1, i.code, i.description, i.brand || '', i.unit || '', num(i.quantity), brl(i.unit_price), brl(Number(i.quantity) * Number(i.unit_price))]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.3, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 }, valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.8, lineWidth: 0 },
    alternateRowStyles: { fillColor: [248, 250, 253] },
    columnStyles: { 0: { cellWidth: 8, halign: 'center', textColor: CINZA }, 1: { cellWidth: 15, textColor: CINZA }, 3: { cellWidth: 24, textColor: CINZA }, 4: { cellWidth: 10, halign: 'center' }, 5: { cellWidth: 12, halign: 'right' }, 6: { cellWidth: 24, halign: 'right' }, 7: { cellWidth: 26, halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d) => { if (d.section === 'head' && d.column.index >= 5) d.cell.styles.halign = 'right'; if (d.section === 'head' && [0, 4].includes(d.column.index)) d.cell.styles.halign = 'center'; },
    didDrawPage: (d) => {
      if (d.pageNumber > 1) { cor('setFillColor', NAVY); pdf.rect(0, 0, 210, 14, 'F'); txt(`${c.name || 'HIGIVARO'}  •  ${ehVenda ? 'Pedido de venda' : 'Orçamento'} Nº ${doc.number}`, M, 9, { s: 9, b: true, c: [255, 255, 255] }); txt(doc.client_name || '', 210 - M, 9, { s: 8, c: [220, 232, 245], a: 'right' }); }
    },
  });
  y = pdf.lastAutoTable.finalY + 6;

  // Totais (direita) e condições (esquerda)
  const alturaBloco = 40 + (ehVenda ? 26 : 0);
  if (y + alturaBloco > 275) { pdf.addPage(); y = 22; }
  const xT = 210 - M - 78;
  txt('Subtotal', xT + 3, y + 5, { s: 9, c: CINZA }); txt(brl(bruto), 210 - M - 3, y + 5, { s: 9, a: 'right' });
  txt(`Desconto${pct ? ' (' + num(pct) + '%)' : ''}`, xT + 3, y + 11, { s: 9, c: CINZA }); txt(pct ? '− ' + brl(bruto * pct / 100) : brl(0), 210 - M - 3, y + 11, { s: 9, a: 'right', c: pct ? [200, 60, 60] : TINTA });
  cor('setFillColor', NAVY); pdf.roundedRect(xT, y + 15, 78, 14, 2.5, 2.5, 'F');
  txt('TOTAL', xT + 4, y + 23.8, { s: 10, b: true, c: [255, 255, 255] });
  txt(brl(bruto * (1 - pct / 100)), 210 - M - 4, y + 24.2, { s: 15, b: true, c: VERDE, a: 'right' });

  const lw = xT - M - 6;
  cor('setFillColor', FUNDO); cor('setDrawColor', LINHA); pdf.roundedRect(M, y, lw, 29, 2.5, 2.5, 'FD');
  rotulo('Condições', M + 4, y + 5.5);
  const cond = ['Pagamento: Pix, cartão ou dinheiro.', 'Entrega: combinada pelo WhatsApp ' + (c.phone || '') + '.', ehVenda ? 'Confira os produtos no recebimento.' : 'Preços válidos por 7 dias a partir da emissão.'];
  cond.forEach((t, k) => txt(t, M + 4, y + 11 + k * 5.2, { s: 8.3 }));
  y += 35;

  const obs = [doc.observations, c.observations_text].filter(Boolean).join('\n');
  if (obs) {
    const linhas = pdf.splitTextToSize(obs, L - 8);
    if (y + 10 + linhas.length * 4 > 275) { pdf.addPage(); y = 22; }
    rotulo('Observações', M, y + 2); txt(linhas, M, y + 7, { s: 8.3 }); y += 9 + linhas.length * 4;
  }
  if (ehVenda) {
    if (y + 24 > 275) { pdf.addPage(); y = 22; }
    y += 14; cor('setDrawColor', CINZA); pdf.setLineWidth(0.3);
    pdf.line(M, y, M + 95, y); pdf.line(M + 115, y, 210 - M, y);
    txt('Assinatura do cliente (recebi os produtos acima)', M, y + 4.5, { s: 7.5, c: CINZA });
    txt('Data do recebimento', M + 115, y + 4.5, { s: 7.5, c: CINZA });
  }

  // Rodapé com numeração em todas as páginas
  const n = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p);
    cor('setDrawColor', LINHA); pdf.setLineWidth(0.3); pdf.line(M, 284, 210 - M, 284);
    txt('HIGIVARO  •  Qualidade  •  Variedade  •  Confiança', M, 289, { s: 7.5, b: true, c: AZUL });
    txt('WhatsApp ' + (c.phone || '') + '  •  higivarooficial.github.io', 105, 289, { s: 7.5, c: CINZA, a: 'center' });
    txt(`Página ${p} de ${n}`, 210 - M, 289, { s: 7.5, c: CINZA, a: 'right' });
  }
  pdf.save(`${ehVenda ? 'Venda' : 'Orcamento'}-${doc.number}-${String(doc.client_name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').slice(0, 30)}.pdf`);
}

rotear();
