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
  if (!erro && /salv|registrad|lançad|excluíd|atualizad|importad/i.test(msg)) S.sujo = false; // só mensagem de salvamento libera a saída
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
  [/^#\/produtos$/, () => telaSecao('produtos')],
  [/^#\/produtos\/(lista|estoque|novo|importar)$/, (m) => telaProdutos(m)],
  [/^#\/produtos\/abc$/, telaCurvaABC],
  [/^#\/produtos\/validade$/, telaValidade],
  [/^#\/orcamento\/novo(?:\?cliente=(\d+))?$/, (cod) => telaEditorOrcamento(null, cod)],
  [/^#\/clientes$/, () => telaSecao('clientes')],
  [/^#\/clientes\/(novo|lista)$/, (modo) => telaClientes(modo)],
  [/^#\/orcamento\/([\w-]+)\/editar$/, (id) => telaEditorOrcamento(id)],
  [/^#\/orcamento\/([\w-]+)$/, telaOrcamento],
  [/^#\/orcamentos$/, () => telaSecao('orcamentos')],
  [/^#\/orcamentos\/(abertos|todos)$/, (m) => telaOrcamentos(m)],
  [/^#\/vendas$/, () => telaSecao('vendas')],
  [/^#\/vendas\/lista$/, () => telaVendas('lista')],
  [/^#\/vendas\/devolvidas$/, () => telaDevolucoes('vendas')],
  [/^#\/venda\/([\w-]+)$/, telaVenda],
  [/^#\/financeiro$/, () => telaSecao('financeiro')],
  [/^#\/financeiro\/resumo$/, telaFinanceiro],
  [/^#\/financeiro\/receber$/, telaAReceber],
  [/^#\/financeiro\/quitadas$/, telaQuitadas],
  [/^#\/financeiro\/devolucoes$/, () => telaDevolucoes('financeiro')],
  [/^#\/financeiro\/despesas$/, () => telaDespesas('lista')],
  [/^#\/financeiro\/despesas\/nova$/, () => telaDespesas('nova')],
  [/^#\/admin$/, () => telaSecao('admin')],
  [/^#\/notas$/, () => telaSecao('notas')],
  [/^#\/notas\/(xml|pdf|lista)$/, (m) => telaNotas(m)],
  [/^#\/nota\/([\w-]+)$/, telaNotaEntrada],
  [/^#\/admin\/(empresa|usuarios|precos)$/, (m) => telaAdmin(m)],
];
async function rotear() {
  const h = location.hash || '#/';
  for (const [re, fn, publica] of ROTAS) {
    const m = h.match(re);
    if (!m) continue;
    if (publica) { $('#topo').hidden = true; return fn(m[1]).catch(falhou); }
    if (!(await garantirAcesso())) return;
    montarMenu(h); S.sujo = false; S.navegacoes = (S.navegacoes || 0) + 1;
    const area = areaDoEndereco(h);
    if (area && !pode(area)) { app.innerHTML = '<div class="card vazio">🔒 Você não tem permissão para esta área. Peça ao administrador para liberar em Admin › Usuários e acessos.</div>'; return; }
    app.innerHTML = '<p class="carregando">Carregando…</p>';
    return fn(m[1]).catch(falhou);
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', rotear);

// ---------- permissões por usuário ----------
// Áreas que o administrador libera para cada usuário (Admin › Usuários e acessos). Sem lista definida = todas liberadas.
const AREAS = [['orcamentos', 'Orçamentos'], ['vendas', 'Vendas e a receber'], ['clientes', 'Clientes'], ['produtos', 'Produtos (consulta)'], ['financeiro', 'Financeiro (resumo)'], ['editar_produtos', 'Editar produtos e preços']];
const pode = (area) => ehAdmin() || (area === 'editar_produtos' ? Array.isArray(S.perfil?.permissions) && S.perfil.permissions.includes(area) : !Array.isArray(S.perfil?.permissions) || S.perfil.permissions.includes(area));
const podeEditarProdutos = () => pode('editar_produtos');
function areaDoEndereco(h) {
  if (/^#\/orcamento/.test(h)) return 'orcamentos';
  if (/^#\/financeiro\/(receber|quitadas|devolucoes)$/.test(h)) return pode('vendas') ? 'vendas' : 'financeiro';
  if (/^#\/venda/.test(h)) return 'vendas';
  if (/^#\/cliente/.test(h)) return 'clientes';
  if (/^#\/produto/.test(h)) return 'produtos';
  if (/^#\/financeiro/.test(h)) return 'financeiro';
  return null;
}

// ---------- voltar e "deseja salvar?" ----------
// Qualquer digitação num formulário marca a tela como "com alterações"; ao sair sem salvar, o sistema pergunta.
const CAMPOS_DE_BUSCA = /^(busca|bp|bcli|addItem|mes|sit|st|tipo|prazo)$/;
['input', 'change'].forEach((ev) => document.addEventListener(ev, (e) => {
  const el = e.target; if (!el.closest || !el.closest('#app') || el.closest('.fundo-dialogo')) return;
  if (CAMPOS_DE_BUSCA.test(el.id) || el.classList.contains('buscaProd') || el.type === 'file') return;
  S.sujo = true;
}, true));
// Cliques que mudam o que está sendo montado (escolher produto/sugestão, remover item, parcela) também contam como alteração.
document.addEventListener('click', (e) => {
  if (e.target.closest('#app .sugestoes [data-id], #app [data-sug], #app [data-x], #app [data-xp], #app [data-usar], #app #maisParc')) S.sujo = true;
}, true);
window.addEventListener('beforeunload', (e) => { if (S.sujo) { e.preventDefault(); e.returnValue = ''; } });
function perguntarSalvar() {
  return new Promise((fim) => {
    const f = document.createElement('div'); f.className = 'fundo-dialogo';
    f.innerHTML = `<div class="card dialogo"><h2 style="margin-top:0">Alterações não salvas</h2><p>Você fez alterações nesta tela. Deseja salvar antes de sair?</p>
      <div class="acoes"><button class="btn pri" data-r="salvar">Salvar e sair</button><button class="btn perigo" data-r="sair">Sair sem salvar</button><button class="btn" data-r="continuar">Continuar editando</button></div></div>`;
    document.body.appendChild(f);
    f.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { f.remove(); fim(b.dataset.r); }));
  });
}
function voltar(base) { if ((S.navegacoes || 0) > 1 && history.length > 1) history.back(); else location.hash = base || '#/'; }
document.addEventListener('click', async (e) => {
  const v = e.target.closest('[data-voltar]'); const a = !v && e.target.closest('a[href^="#"]');
  if (!v && !a) return; if (a && a.target === '_blank') return;
  if (S.sujo) {
    e.preventDefault(); e.stopPropagation();
    const r = await perguntarSalvar(); if (r === 'continuar') return;
    if (r === 'salvar') {
      const b = $$('#app button.pri, #app .btn.pri').find((x) => x.offsetParent && !x.closest('[data-voltar]'));
      if (!b) return aviso('Não achei o botão de salvar desta tela; salve manualmente.', true);
      b.click(); await new Promise((ok) => setTimeout(ok, 1500)); if (S.sujo) return; // não salvou (faltou campo ou cancelou)
    }
    S.sujo = false;
    if (v) voltar(v.dataset.voltar); else location.hash = a.getAttribute('href');
    return;
  }
  if (v) { e.preventDefault(); voltar(v.dataset.voltar); }
}, true);
const barraVoltar = (titulo, base) => `<div class="topo-secao"><button class="btn voltar" data-voltar="${base}">← Voltar</button><h1>${titulo}</h1></div>`;

// Barra de botões grandes com ícone (estilo sistema de balcão): um clique para cada área.
const ICONES = {
  inicio: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  novo: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
  orcamentos: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  vendas: '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>',
  produtos: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 5"/>',
  novoCliente: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  receber: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  devolucao: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  alerta: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  importar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  grafico: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  empresa: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4"/>',
  usuarios: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  despesas: '<path d="M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  nota: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 13h2v4H8zM12 13h1M15 13h1M12 17h4"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 14v3l2 1"/>',
  foto: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  financeiro: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sair: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  quitada: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.8"/>',
  preco: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
};
const icone = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONES[n]}</svg>`;
// Cada área do menu abre com botões grandes de opções sobre o tema (pedido do dono).
const SECOES = {
  orcamentos: ['Orçamentos', [['#/orcamento/novo', 'novo', 'Novo orçamento'], ['#/orcamentos/abertos', 'orcamentos', 'Orçamentos em aberto'], ['#/orcamentos/todos', 'lista', 'Todos os orçamentos']]],
  vendas: ['Vendas', [['#/vendas/lista', 'vendas', 'Vendas do mês'], ['#/financeiro/receber', 'receber', 'A receber (em aberto)'], ['#/vendas/devolvidas', 'devolucao', 'Devoluções']]],
  clientes: ['Clientes', [['#/clientes/novo', 'novoCliente', 'Cadastrar novo cliente'], ['#/clientes/lista', 'clientes', 'Clientes cadastrados']]],
  produtos: ['Produtos', [['#/produtos/lista', 'produtos', 'Consultar produtos'], ['#/produtos/estoque', 'alerta', 'Estoque zerado ou baixo'], ['#/produtos/abc', 'grafico', 'Curva ABC'], ['#/produtos/validade', 'calendario', 'Próximos do vencimento', 1], ['#/produtos/novo', 'novo', 'Cadastrar produto', 'ep'], ['#/produtos/importar', 'importar', 'Importar planilha', 'ep']]],
  financeiro: ['Financeiro', [['#/financeiro/resumo', 'grafico', 'Resumo do mês'], ['#/financeiro/receber', 'receber', 'A receber (em aberto)'], ['#/financeiro/despesas', 'despesas', 'Despesas (a pagar)', 1], ['#/financeiro/despesas/nova', 'novo', 'Lançar despesa', 1], ['#/financeiro/quitadas', 'quitada', 'Quitadas'], ['#/financeiro/devolucoes', 'devolucao', 'Devoluções']]],
  admin: ['Administração', [['#/admin/empresa', 'empresa', 'Dados da empresa', 1], ['#/admin/usuarios', 'usuarios', 'Usuários e acessos', 1], ['#/admin/precos', 'preco', 'Formação de preços', 1]]],
  notas: ['Notas fiscais', [['#/notas/xml', 'importar', 'Entrada por XML', 1], ['#/notas/pdf', 'foto', 'Entrada por PDF ou foto', 1], ['#/notas/lista', 'lista', 'Notas de entrada', 1]]],
};
// Com uma opção escolhida, mostra só o título + "← Voltar" (os outros botões somem); sem opção, mostra os botões.
const secao = (nome, atual) => { const [titulo, itens] = SECOES[nome]; if (atual) { const op = itens.find((i) => i[0] === atual); return barraVoltar(`${titulo}${op ? ' <span class="subtitulo">› ' + op[2] + '</span>' : ''}`, '#/' + nome); } return `<h1>${titulo}</h1><div class="atalhos">${itens.filter((i) => !i[3] || (i[3] === 'ep' ? podeEditarProdutos() : ehAdmin())).map(([href, ic, rot]) => `<a href="${href}" class="${href === atual ? 'ativo' : ''}">${icone(ic)}<span>${rot}</span></a>`).join('')}</div>`; };
async function telaSecao(nome) { if ((nome === 'admin' || nome === 'notas') && !ehAdmin()) { app.innerHTML = '<p class="vazio">Acesso restrito ao administrador.</p>'; return; } app.innerHTML = secao(nome, ''); }
function montarMenu(h) {
  $('#topo').hidden = false;
  $('#quem').textContent = (S.perfil?.full_name || '') + (ehAdmin() ? ' · administrador' : '');
  const itens = [['#/', 'Início', 'inicio'], ['#/orcamentos', 'Orçamentos', 'orcamentos'], ['#/vendas', 'Vendas', 'vendas'], ['#/clientes', 'Clientes', 'clientes'], ['#/produtos', 'Produtos', 'produtos'], ['#/financeiro', 'Financeiro', 'financeiro']];
  if (ehAdmin()) itens.push(['#/notas', 'Notas fiscais', 'nota'], ['#/admin', 'Admin', 'admin']);
  for (let k = itens.length - 1; k > 0; k--) { const area = itens[k][0].slice(2); if (AREAS.some(([a]) => a === area) && !pode(area)) itens.splice(k, 1); }
  const ativo = (href) => h === href || (href !== '#/' && h.startsWith(href + '/')) || (href === '#/orcamentos' && /^#\/orcamento\/(?!novo)/.test(h)) || (href === '#/vendas' && h.startsWith('#/venda/')) || (href === '#/notas' && h.startsWith('#/nota/')) || (href === '#/financeiro' && h.startsWith('#/financeiro')) || (href === '#/clientes' && h.startsWith('#/clientes'));
  $('#menu').innerHTML = itens.map(([href, t, ic]) => `<a href="${href}" class="${ativo(href) ? 'ativo' : ''}">${icone(ic)}<span>${t}</span></a>`).join('') + `<button id="sair" class="sair">${icone('sair')}<span>Sair</span></button>`;
  $('#sair').onclick = async () => { await sb.auth.signOut(); S.user = S.perfil = S.empresa = null; location.hash = '#/'; rotear(); };
}

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
    app.innerHTML = `<div class="card auth"><h1>Aguardando liberação</h1><p>Seu cadastro (${esc(S.user.email)}) foi recebido. O administrador da HIGIVARO precisa liberar o seu acesso.</p><div class="acoes"><button class="btn" onclick="location.reload()">Já fui liberado</button><button class="btn perigo" id="sairEspera">Sair</button></div></div>`;
    $('#sairEspera').onclick = async () => { await sb.auth.signOut(); location.reload(); };
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
    ${modo === 'entrar' ? '<label>Nº do usuário ou e-mail</label><input name="email" required autocomplete="username">' : '<label>E-mail</label><input name="email" type="email" required autocomplete="email">'}
    ${modo !== 'esqueci' ? `<label>Senha</label><input name="senha" type="password" minlength="8" required autocomplete="${modo === 'cadastro' ? 'new-password' : 'current-password'}">` : ''}
    <div class="acoes"><button class="btn pri grande">${titulo}</button></div></form>
    <div class="acoes">
      ${modo !== 'entrar' ? '<a href="#" data-m="entrar">Já tenho acesso</a>' : '<a href="#" data-m="esqueci">Esqueci a senha</a> · <small style="color:var(--muted)">Não tem acesso? Peça ao administrador da HIGIVARO.</small>'}
    </div></div></div>`;
  $$('[data-m]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); telaLogin(a.dataset.m); }));
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); const b = $('#f button'); b.disabled = true;
    try {
      if (modo === 'entrar') {
        // Número de usuário (definido pelo administrador) vira o e-mail de login.
        let login = String(f.email).trim();
        if (/^[0-9]{1,5}$/.test(login)) { const em = await ok(sb.rpc('email_do_login', { p_num: Number(login) })); if (!em) throw new Error('usuário nº ' + login + ' não encontrado'); login = em; }
        await ok(sb.auth.signInWithPassword({ email: login, password: f.senha })); S.avisosPendentes = true; rotear();
      }
      if (modo === 'cadastro') {
        const r = await ok(sb.auth.signUp({ email: f.email, password: f.senha, options: { data: { full_name: f.nome }, emailRedirectTo: location.origin + location.pathname } }));
        if (r.user) enviarBoasVindas(r.user.id); // e-mail "recebemos seu pedido" + aviso para a empresa
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
  // No primeiro acesso (senha temporária dada pelo administrador) só o logo e o "Sair" ficam visíveis até criar a senha pessoal.
  $('#topo').hidden = !obrigatoria; if (obrigatoria) $('#menu').innerHTML = `<button id="sair" class="sair">${icone('sair')}<span>Sair</span></button>`;
  if ($('#sair')) $('#sair').onclick = async () => { await sb.auth.signOut(); S.user = S.perfil = S.empresa = null; location.hash = '#/'; rotear(); };
  app.innerHTML = `<div class="auth card"><h1>${obrigatoria ? 'Bem-vindo(a)! Crie a sua senha pessoal' : 'Criar nova senha'}</h1>
    ${obrigatoria ? '<p style="color:var(--muted)">Você entrou com uma <b>senha temporária</b>. Para continuar, crie a sua senha pessoal (mínimo 8 caracteres, diferente da temporária). Só você vai saber essa senha.</p>' : ''}
    <form id="f"><label>Nova senha</label><input name="s1" type="password" minlength="8" required autocomplete="new-password"><label>Repita a senha</label><input name="s2" type="password" minlength="8" required autocomplete="new-password"><div class="acoes"><button class="btn pri grande">Salvar minha senha</button></div></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.s1 !== f.s2) return aviso('As senhas não são iguais.', true);
    try {
      const { error } = await sb.auth.updateUser({ password: f.s1 });
      if (error) throw new Error(/different|same/i.test(error.message) ? 'a nova senha precisa ser diferente da senha temporária' : error.message);
      await ok(sb.rpc('atualizar_meu_perfil', { p_nome: null, p_senha_trocada: true }));
      S.perfil = null; aviso('Senha salva.'); location.hash = '#/'; rotear();
    } catch (err) { falhou(err); }
  };
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') telaTrocarSenha(false); });

// ---------- início ----------
// Tela inicial: logo da HIGIVARO + janelas com os avisos do dia (vencimentos de hoje, atrasados, validade dos lotes).
// Cada janela só aparece para quem tem acesso àquela área.
async function telaInicio() {
  app.innerHTML = `<div class="inicio-logo"><img src="logo-inicio.jpg" alt="HIGIVARO - Distribuidora de produtos de limpeza"></div>`;
  // Avisos do dia: abrem toda vez que o usuário entra no sistema (login ou abrir o sistema); não repetem ao só voltar ao Início.
  if (S.avisosPendentes !== false) { S.avisosPendentes = false; mostrarAvisos(); }
}
// Janelas de aviso sobre a tela (cada uma com ✕): vencimentos de hoje a receber / a pagar e produtos perto da validade.
async function mostrarAvisos() {
  let d; try { d = await ok(sb.rpc('painel_inicio')); } catch (e) { console.error(e); return; }
  if (!/^#\/?$/.test(location.hash || '#/')) return; // a pessoa já saiu da tela inicial
  const soma = (l) => l.reduce((s, x) => s + Number(x.valor || 0), 0);
  const lista = (itens, linha, max = 5) => `<ul>${itens.slice(0, max).map(linha).join('')}</ul>${itens.length > max ? `<small class="mais">+ ${itens.length - max} ${itens.length - max === 1 ? 'outro' : 'outros'}</small>` : ''}`;
  const rodape = (at, p7, fem) => `<div class="rodape-janela"><span class="${at?.n ? 'ruim' : ''}">⚠️ ${fem ? 'Atrasadas' : 'Atrasados'}: <b>${at?.n || 0}</b>${at?.n ? ' · ' + brl(at.valor) : ''}</span><span>📅 Próximos 7 dias: <b>${p7?.n || 0}</b>${p7?.n ? ' · ' + brl(p7.valor) : ''}</span></div>`;
  const janela = (cls, titulo, corpo, href, rotLink) => `<div class="janela ${cls}"><button class="fechar-janela" title="Fechar">✕</button><h3>${titulo}</h3>${corpo}${href ? `<a class="ver-mais" href="${href}">${rotLink} →</a>` : ''}</div>`;
  const jan = [];
  if (d.receber_hoje && (d.receber_hoje.length || d.receber_atrasado?.n))
    jan.push(janela('receber', '💰 Vencem hoje · a receber', `<div class="valor">${brl(soma(d.receber_hoje))}<small>${d.receber_hoje.length} ${d.receber_hoje.length === 1 ? 'venda' : 'vendas'} vencendo hoje</small></div>
      ${d.receber_hoje.length ? lista(d.receber_hoje, (x) => `<li><span>Nº ${esc(x.numero)} · ${esc(x.cliente)}</span><b>${brl(x.valor)}</b></li>`) : '<p class="tudo-ok">Nenhum recebimento vence hoje.</p>'}${rodape(d.receber_atrasado, d.receber_7d)}`, '#/financeiro/receber', 'Ver a receber'));
  if (d.pagar_hoje && (d.pagar_hoje.length || d.pagar_atrasado?.n))
    jan.push(janela('pagar', '🧾 Vencem hoje · a pagar', `<div class="valor">${brl(soma(d.pagar_hoje))}<small>${d.pagar_hoje.length} ${d.pagar_hoje.length === 1 ? 'conta vencendo' : 'contas vencendo'} hoje</small></div>
      ${d.pagar_hoje.length ? lista(d.pagar_hoje, (x) => `<li><span>${esc(x.descricao)}${x.fornecedor ? ' · ' + esc(x.fornecedor) : ''}</span><b>${brl(x.valor)}</b></li>`) : '<p class="tudo-ok">Nenhuma conta vence hoje.</p>'}${rodape(d.pagar_atrasado, d.pagar_7d, true)}`, '#/financeiro/despesas', 'Ver despesas'));
  if (d.validade && d.validade.length) {
    const vn = d.validade_n || {};
    jan.push(janela('validade', '⏳ Produtos próximos do vencimento', `<div class="chips-validade"><span class="v1">${vn.vencidos || 0} vencidos</span><span class="v2">${vn.em30 || 0} em até 30 dias</span><span class="v3">${vn.em60 || 0} em 31 a 60 dias</span></div>
      ${lista(d.validade, (x) => `<li><span>${dataBR(x.validade)} · ${esc(x.produto)}${x.lote ? ' <small>lote ' + esc(x.lote) + '</small>' : ''}</span><b class="${x.dias < 0 ? 'ruim' : x.dias <= 30 ? 'atencao' : ''}">${x.dias < 0 ? 'venceu' : x.dias === 0 ? 'hoje' : 'em ' + x.dias + (x.dias === 1 ? ' dia' : ' dias')}</b></li>`, 6)}`, ehAdmin() ? '#/produtos/validade' : '', 'Ver todos'));
  }
  if (!jan.length) jan.push(janela('receber', '✅ Tudo em dia', '<p class="tudo-ok" style="margin:4px 0 0">Nada vence hoje, nada atrasado e nenhum produto perto do vencimento. Bom trabalho!</p>'));
  const f = document.createElement('div'); f.className = 'fundo-avisos';
  f.innerHTML = `<div class="avisos"><div class="avisos-topo"><b>Avisos do dia · ${dataBR(hoje())}</b><button class="btn" id="fecharAvisos">Fechar todos</button></div><div class="avisos-lista">${jan.join('')}</div></div>`;
  document.body.appendChild(f);
  const fechar = () => f.remove();
  $('#fecharAvisos', f).onclick = fechar;
  f.onclick = (e) => { if (e.target === f) fechar(); };
  $$('.fechar-janela', f).forEach((b) => (b.onclick = () => { b.closest('.janela').remove(); if (!$('.janela', f)) fechar(); }));
  $$('.ver-mais', f).forEach((a) => a.addEventListener('click', fechar));
  window.addEventListener('hashchange', fechar, { once: true });
}

// ---------- produtos ----------
// Busca por palavras-chave: cada palavra precisa aparecer (em qualquer ordem) no código, descrição, marca ou unidade,
// sem diferenciar acento e maiúscula. Resultado do mais barato para o mais caro.
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function buscarProdutos(t, limite = 30, incluirInativos = false) {
  let q = sb.from('products').select('*').order('price', { ascending: true }).order('description').limit(limite);
  for (const p of semAcento(limpaBusca(t)).split(/\s+/).filter(Boolean)) q = q.ilike('busca', `%${p}%`);
  if (!incluirInativos) q = q.neq('active', false);
  return ok(q);
}
// ---------- Curva ABC ----------
// Faturamento por produto nas vendas confirmadas do período; A = até 80% do faturamento acumulado, B = até 95%, C = o resto.
async function telaCurvaABC() {
  app.innerHTML = `${secao('produtos', '#/produtos/abc')}
  <div class="linha"><div style="flex:0 1 220px"><label>Período</label><select id="per"><option value="30">Últimos 30 dias</option><option value="90" selected>Últimos 90 dias</option><option value="180">Últimos 6 meses</option><option value="365">Últimos 12 meses</option></select></div>
    <div style="flex:0 1 220px"><label>Mostrar</label><select id="cls"><option value="">Todas as classes</option><option>A</option><option>B</option><option>C</option><option value="S">Sem venda (com estoque)</option></select></div>
    <div><label>Buscar</label><input id="busca" placeholder="Palavras-chave do produto"></div></div>
  <div class="acoes"><button class="btn azul" id="relatorio">📄 Gerar relatório (PDF)</button></div>
  <div id="kpis" class="grade" style="margin-top:12px"></div>
  <p style="color:var(--muted);font-size:13px;margin:8px 0 0"><b>A</b> = produtos que somam até 80% do faturamento (os mais importantes) · <b>B</b> = até 95% · <b>C</b> = os 5% finais · <b>Sem venda</b> = têm estoque mas não venderam no período.</p>
  <div class="tabela" style="margin-top:10px"><table><thead><tr><th>Classe</th><th>Código</th><th>Produto</th><th class="num">Qtd vendida</th><th class="num">Faturamento</th><th class="num esconde-cel">% do total</th><th class="num esconde-cel">% acumulado</th><th class="num">Estoque</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  let linhas = [], resumo = {};
  const carregar = async () => {
    const ini = new Date(Date.now() - Number($('#per').value) * 864e5).toLocaleDateString('sv-SE');
    const [its, prods] = await Promise.all([
      ok(sb.from('sale_items').select('product_id,code,description,brand,quantity,total,sales!inner(date,status)').eq('sales.status', 'confirmada').gte('sales.date', ini).limit(20000)),
      ok(sb.from('products').select('id,code,description,brand,stock,price').limit(5000)),
    ]);
    const porProd = new Map();
    its.forEach((i) => { const k = i.product_id || 'cod:' + i.code; const x = porProd.get(k) || { id: i.product_id, code: i.code, description: i.description, brand: i.brand, qtd: 0, fat: 0 }; x.qtd += Number(i.quantity); x.fat += Number(i.total); porProd.set(k, x); });
    const total = [...porProd.values()].reduce((s, x) => s + x.fat, 0);
    let acum = 0;
    const vendidos = [...porProd.values()].sort((a, b) => b.fat - a.fat).map((x) => { const pct = total ? (x.fat / total) * 100 : 0; const antes = acum; acum += pct; const est = prods.find((p) => p.id === x.id); return { ...x, pct, acum, classe: antes < 80 ? 'A' : antes < 95 ? 'B' : 'C', stock: est ? est.stock : null }; });
    const semVenda = prods.filter((p) => Number(p.stock) > 0 && !porProd.has(p.id)).map((p) => ({ id: p.id, code: p.code, description: p.description, brand: p.brand, qtd: 0, fat: 0, pct: 0, acum: null, classe: 'S', stock: p.stock }));
    linhas = [...vendidos, ...semVenda];
    resumo = { total, A: vendidos.filter((x) => x.classe === 'A'), B: vendidos.filter((x) => x.classe === 'B'), C: vendidos.filter((x) => x.classe === 'C'), S: semVenda };
    const soma = (l) => l.reduce((s, x) => s + x.fat, 0);
    $('#kpis').innerHTML = ['A', 'B', 'C'].map((c) => `<div class="kpi"><small>Classe ${c} · ${resumo[c].length} produto(s)</small><strong>${brl(soma(resumo[c]))}</strong></div>`).join('') + `<div class="kpi"><small>Sem venda (com estoque)</small><strong>${resumo.S.length}</strong></div>`;
    desenhar();
  };
  const desenhar = () => {
    let l = linhas; const c = $('#cls').value; if (c) l = l.filter((x) => x.classe === c);
    const ps = semAcento(limpaBusca($('#busca').value)).split(/\s+/).filter(Boolean); if (ps.length) l = l.filter((x) => ps.every((p) => semAcento(`${x.code} ${x.description} ${x.brand || ''}`).includes(p)));
    $('#lista').innerHTML = l.slice(0, 600).map((x) => `<tr><td><span class="selo classe-${x.classe}">${x.classe === 'S' ? 'sem venda' : x.classe}</span></td><td>${esc(x.code)}</td><td>${esc(x.description)}<br><small style="color:var(--muted)">${esc(x.brand || '')}</small></td><td class="num">${String(x.qtd).replace('.', ',')}</td><td class="num"><b>${brl(x.fat)}</b></td><td class="num esconde-cel">${x.pct.toFixed(1).replace('.', ',')}%</td><td class="num esconde-cel">${x.acum == null ? '—' : x.acum.toFixed(1).replace('.', ',') + '%'}</td><td class="num">${x.stock ?? '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhuma venda no período.</td></tr>';
  };
  $('#per').onchange = carregar; $('#cls').onchange = desenhar; let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(desenhar, 200); };
  $('#relatorio').onclick = () => pdfTabela('CURVA ABC', $('#per').selectedOptions[0].text + ($('#cls').value ? ' • ' + $('#cls').selectedOptions[0].text : ''),
    [['Faturamento', brl(resumo.total)], ['Classe A', `${resumo.A.length} prod.`], ['Classe B', `${resumo.B.length} prod.`], ['Classe C', `${resumo.C.length} prod.`]],
    ['Classe', 'Código', 'Produto', 'Qtd', 'Faturamento', '%', '% acum.', 'Estoque'],
    linhas.filter((x) => !$('#cls').value || x.classe === $('#cls').value).map((x) => [x.classe === 'S' ? 'Sem venda' : x.classe, x.code, x.description, String(x.qtd).replace('.', ','), brl(x.fat), x.pct.toFixed(1).replace('.', ',') + '%', x.acum == null ? '—' : x.acum.toFixed(1).replace('.', ',') + '%', String(x.stock ?? '—')]),
    { 0: { cellWidth: 16, fontStyle: 'bold' }, 1: { cellWidth: 14 }, 3: { cellWidth: 14, halign: 'right' }, 4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' }, 5: { cellWidth: 14, halign: 'right' }, 6: { cellWidth: 16, halign: 'right' }, 7: { cellWidth: 16, halign: 'right' } }, 'Curva-ABC').catch(falhou);
  carregar();
}
// ---------- Próximos do vencimento ----------
// Lotes que entraram pelas notas fiscais, com validade, de produtos que ainda têm estoque.
async function telaValidade() {
  if (!ehAdmin()) { app.innerHTML = '<p class="vazio">Acesso restrito ao administrador.</p>'; return; }
  app.innerHTML = `${secao('produtos', '#/produtos/validade')}
  <div class="linha"><div style="flex:0 1 240px"><label>Mostrar</label><select id="prazo"><option value="0">Já vencidos</option><option value="30">Vencem em até 30 dias</option><option value="60" selected>Vencem em até 60 dias</option><option value="90">Vencem em até 90 dias</option><option value="180">Vencem em até 6 meses</option><option value="9999">Todos com validade</option></select></div>
    <div><label>Buscar</label><input id="busca" placeholder="Palavras-chave do produto ou lote"></div></div>
  <div class="acoes"><button class="btn azul" id="relatorio">📄 Gerar relatório (PDF)</button></div>
  <div id="kpis" class="grade" style="margin-top:12px"></div>
  <p style="color:var(--muted);font-size:13px;margin:8px 0 0">A validade vem do lote informado na <b>entrada da nota fiscal</b>. Só aparecem produtos com estoque. O sistema ainda não sabe de qual lote saiu cada venda; use a lista para priorizar a venda dos lotes mais antigos.</p>
  <div class="tabela" style="margin-top:10px"><table><thead><tr><th>Validade</th><th>Situação</th><th>Produto</th><th>Lote</th><th class="num esconde-cel">Entrou</th><th class="num">Estoque atual</th><th class="esconde-cel">NF / fornecedor</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  let linhas = [];
  const carregar = async () => {
    const dias = Number($('#prazo').value), lim = new Date(Date.now() + dias * 864e5).toLocaleDateString('sv-SE');
    let q = sb.from('purchase_items').select('lot,expiry,stock_added,quantity,products!inner(id,code,description,brand,stock),purchase_invoices(number,supplier_name)').not('expiry', 'is', null).gt('products.stock', 0).order('expiry').limit(3000);
    q = dias === 0 ? q.lt('expiry', hoje()) : q.lte('expiry', lim);
    linhas = await ok(q);
    const venc = linhas.filter((l) => diasAtraso(l.expiry) > 0), em30 = linhas.filter((l) => diasAtraso(l.expiry) <= 0 && diasAtraso(l.expiry) > -30);
    $('#kpis').innerHTML = `<div class="kpi"><small>Lotes na lista</small><strong>${linhas.length}</strong></div><div class="kpi"><small>Já vencidos</small><strong style="color:var(--red)">${venc.length}</strong></div><div class="kpi"><small>Vencem em até 30 dias</small><strong style="color:#b07800">${em30.length}</strong></div>`;
    desenhar();
  };
  const situacao = (l) => { const d = diasAtraso(l.expiry); return d > 0 ? `Vencido há ${d} ${d === 1 ? 'dia' : 'dias'}` : d === 0 ? 'Vence hoje' : `Vence em ${-d} ${d === -1 ? 'dia' : 'dias'}`; };
  const desenhar = () => {
    let l = linhas; const ps = semAcento(limpaBusca($('#busca').value)).split(/\s+/).filter(Boolean);
    if (ps.length) l = l.filter((x) => ps.every((p) => semAcento(`${x.products.code} ${x.products.description} ${x.lot || ''}`).includes(p)));
    $('#lista').innerHTML = l.map((x) => { const d = diasAtraso(x.expiry); return `<tr><td><b>${dataBR(x.expiry)}</b></td><td><span class="selo ${d > 0 ? 'vencido' : d > -30 ? 'aviso-venc' : 'aberto'}">${situacao(x)}</span></td><td>${esc(x.products.code)} · ${esc(x.products.description)}<br><small style="color:var(--muted)">${esc(x.products.brand || '')}</small></td><td>${esc(x.lot || '—')}</td><td class="num esconde-cel">${x.stock_added}</td><td class="num"><b>${x.products.stock}</b></td><td class="esconde-cel"><small>${x.purchase_invoices ? 'NF ' + esc(x.purchase_invoices.number || '') + ' · ' + esc(x.purchase_invoices.supplier_name || '') : ''}</small></td></tr>`; }).join('') || '<tr><td colspan="7" class="vazio">Nenhum lote neste prazo. 🎉</td></tr>';
  };
  $('#prazo').onchange = carregar; let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(desenhar, 200); };
  $('#relatorio').onclick = () => pdfTabela('PRÓXIMOS DO VENCIMENTO', $('#prazo').selectedOptions[0].text, [['Lotes', String(linhas.length)], ['Já vencidos', String(linhas.filter((l) => diasAtraso(l.expiry) > 0).length)]],
    ['Validade', 'Situação', 'Código', 'Produto', 'Lote', 'Estoque'], linhas.map((x) => [dataBR(x.expiry), situacao(x), x.products.code, x.products.description, x.lot || '—', String(x.products.stock)]),
    { 0: { cellWidth: 20, fontStyle: 'bold' }, 1: { cellWidth: 30 }, 2: { cellWidth: 14 }, 4: { cellWidth: 24 }, 5: { cellWidth: 18, halign: 'right' } }, 'Vencimentos').catch(falhou);
  carregar();
}
// Relatório genérico em PDF (mesmo padrão visual): título, quadros de resumo, tabela e rodapé.
async function pdfTabela(titulo, subtitulo, quadros, cab, corpo, colunas, arquivo) {
  const c = S.empresa || {}; const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4' }); const logo = await carregarLogo();
  const M = 12, L = 186, NAVY = [3, 35, 68], TINTA = [13, 42, 74], CINZA = [96, 114, 138], LINHA = [223, 231, 240], FUNDO = [244, 247, 251];
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' }).slice(0, 17).replace(',', ' às');
  cabecalhoPdf(pdf, c, logo, titulo, subtitulo, 'Gerado em ' + agora);
  let y = 48; const w = (L - 3 * (quadros.length - 1)) / quadros.length;
  quadros.forEach(([r, v], k) => { const x = M + k * (w + 3); pdf.setFillColor(...FUNDO); pdf.setDrawColor(...LINHA); pdf.roundedRect(x, y, w, 17, 2, 2, 'FD'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(...CINZA); pdf.text(r.toUpperCase(), x + 4, y + 6); pdf.setFontSize(12); pdf.setTextColor(...TINTA); pdf.text(v, x + 4, y + 13); });
  pdf.autoTable({ startY: y + 22, margin: { left: M, right: M, top: 20, bottom: 22 }, head: [cab], body: corpo, theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.8, cellPadding: { top: 1.8, bottom: 1.8, left: 1.6, right: 1.6 }, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 }, valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.3, lineWidth: 0 }, alternateRowStyles: { fillColor: [248, 250, 253] }, columnStyles: colunas,
    didDrawPage: (d) => { if (d.pageNumber > 1) { pdf.setFillColor(...NAVY); pdf.rect(0, 0, 210, 14, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255); pdf.text(`HIGIVARO  •  ${titulo}  •  ${agora}`, M, 9); } } });
  rodapePdf(pdf, c); pdf.save(`${arquivo}-${hoje()}.pdf`);
}
async function telaProdutos(modo) {
  if ((modo === 'novo' || modo === 'importar') && !podeEditarProdutos()) { location.hash = '#/produtos'; return; }
  const topo = secao('produtos', '#/produtos/' + modo);
  if (modo === 'novo') { app.innerHTML = `${topo}<div id="form"></div>`; await formProduto(null, () => (location.hash = '#/produtos/lista')); $('#cancela').onclick = () => (location.hash = '#/produtos'); return; }
  if (modo === 'importar') {
    app.innerHTML = `${topo}<div class="card"><h2 style="margin-top:0">Importar planilha de produtos</h2>
      <p>Use um arquivo <b>CSV</b> (no Excel: <i>Salvar como › CSV</i>) com estas colunas na primeira linha:<br><code>codigo; descricao; marca; unidade; estoque; preco</code></p>
      <p style="color:var(--muted)">Produto com código que já existe é <b>atualizado</b> (preço, estoque, descrição); código novo é <b>cadastrado</b>.</p>
      <label class="btn azul" style="margin:0">Escolher arquivo CSV<input type="file" id="csv" accept=".csv,text/csv" hidden></label></div>`;
    $('#csv').onchange = (e) => importarCsv(e.target.files[0], () => (location.hash = '#/produtos/lista'));
    return;
  }
  const estoque = modo === 'estoque';
  app.innerHTML = `${topo}
  <div class="linha"><input id="busca" placeholder="Palavras-chave (ex.: agua 5l candeias) • do mais barato ao mais caro"></div>
  ${estoque ? '<p style="color:var(--muted);margin:8px 0 0">Produtos com estoque <b>até 5 unidades</b>, do menor estoque para o maior.</p>' : ''}
  ${podeEditarProdutos() ? '<p style="color:var(--muted);margin:8px 0 0;font-size:13px">✏️ Dê <b>dois cliques</b> num produto para editar.</p>' : ''}
  <div id="form"></div><div class="tabela" style="margin-top:12px"><table><thead><tr><th>Código</th><th>Descrição</th><th class="esconde-cel">Marca</th><th>Un.</th><th class="num">Estoque</th><th class="num">Preço</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  const carregar = async () => {
    let ps;
    if (estoque) {
      let q = sb.from('products').select('*').lte('stock', 5).order('stock').order('description').limit(500);
      for (const p of semAcento(limpaBusca($('#busca').value)).split(/\s+/).filter(Boolean)) q = q.ilike('busca', `%${p}%`);
      ps = await ok(q);
    } else ps = await buscarProdutos($('#busca').value, 200, true);
    $('#lista').innerHTML = ps.map((p) => `<tr class="${podeEditarProdutos() ? 'clica' : ''}" data-id="${p.id}"><td>${esc(p.code)}</td><td>${esc(p.description)}${p.active === false ? ' <span class="selo devolvida">inativo</span>' : ''}</td><td class="esconde-cel">${esc(p.brand)}</td><td>${esc(p.unit)}</td><td class="num" style="${p.stock <= 0 ? 'color:var(--red)' : ''}">${p.stock}</td><td class="num">${brl(p.price)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum produto.</td></tr>';
    // Editar: dois cliques no produto (só administrador ou quem tem "Editar produtos e preços").
    if (podeEditarProdutos()) $('#lista tr[data-id]').forEach((tr) => { tr.title = 'Dois cliques para editar'; tr.ondblclick = () => { window.getSelection()?.removeAllRanges(); formProduto(ps.find((p) => p.id === tr.dataset.id), carregar); }; });
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); };
  carregar(); $('#busca').focus();
}
// ---------- Cadastro de produto completo (estilo ERP), em abas ----------
// Formação de preço por mark-up: custo final = custo × (1 + acréscimos% − créditos%);
// preço = custo final ÷ (1 − (deduções de venda% + margem%)); PMZ = preço sem lucro.
const CAMPOS_PRECO = {
  cred_icms: 'Créd. ICMS', cred_pis: 'Créd. PIS', cred_cofins: 'Créd. Cofins', cred_ipi: 'Créd. IPI',
  ipi: 'IPI', st: 'Subst. Trib.', fcp: 'FCP', frete: 'Frete', outros_c: 'Outros C.',
  custo_op: 'Custo operac.', trib_fed: 'Trib. federais', pis: 'PIS', cofins: 'Cofins', ir: 'I.R.', csll: 'CSLL', icms: 'ICMS', comissao: 'Comissão', outros_v: 'Outros V.', enc_fin: 'Enc. financ.',
};
const P_CREDITOS = ['cred_icms', 'cred_pis', 'cred_cofins', 'cred_ipi'], P_ACRESC = ['ipi', 'st', 'fcp', 'frete', 'outros_c'];
const P_VENDA = ['custo_op', 'trib_fed', 'pis', 'cofins', 'ir', 'csll', 'icms', 'comissao', 'outros_v', 'enc_fin'];
// Coluna "Custo": valores do próprio produto (ou o padrão do Admin, se for novo).
// Coluna "Preço de venda": impostos automáticos (regime + NCM + CSOSN) e custos de venda do Admin › Formação de preços; só a margem é do produto.
function pricingPadrao(p) {
  const c = configPreco(), base = Object.fromEntries(Object.keys(CAMPOS_PRECO).map((k) => [k, 0]));
  const f = Object.assign(base, { frete: p?.freight_pct ?? c.frete, outros_c: p?.other_pct ?? c.outros_c, margem: p?.margin_pct ?? c.margem }, p?.pricing || {});
  if (!p?.pricing && Number(p?.tax_pct)) f.ipi = Number(p.tax_pct); // "imposto da compra" dos cadastros antigos
  Object.assign(f, { custo_op: c.custo_op, comissao: c.comissao, outros_v: c.outros_v, enc_fin: c.enc_fin }, impostosVenda(p || {}).valores);
  return f;
}
// Padrões da formação de preço definidos pelo administrador.
function configPreco(e = S.empresa || {}) {
  const d = e.pricing_defaults || {}, n = (v, pad) => (v === undefined || v === null || v === '' ? Number(pad) || 0 : Number(v));
  return { regime: e.tax_regime || 'MEI', simples: n(d.simples, 4), icms: n(d.icms, 20.5), frete: n(d.frete, e.default_freight_pct ?? 0), outros_c: n(d.outros_c, e.default_other_pct ?? 0),
    custo_op: n(d.custo_op, 0), comissao: n(d.comissao, 0), outros_v: n(d.outros_v, 0), enc_fin: n(d.enc_fin, 0), margem: n(d.margem, e.default_margin_pct ?? 30) };
}
const REGIMES = [['MEI', 'MEI (imposto fixo no DAS mensal)'], ['SIMPLES', 'Simples Nacional'], ['PRESUMIDO', 'Lucro Presumido'], ['REAL', 'Lucro Real']];
// Revenda monofásica de PIS/Cofins (perfumaria, higiene pessoal, sabonete de toucador, escova de dentes).
const NCM_MONOFASICO = /^(3303|3304|3305|3306|3307|34011190|34012010|96032100)/;
const CSOSN_ST = ['201', '202', '203', '500', '60'];
// Impostos sobre a venda calculados pelo sistema, conforme o regime da empresa e o NCM/CSOSN do produto.
function impostosVenda(prod, c = configPreco()) {
  const st = CSOSN_ST.includes(String(prod?.cst ?? '')), mono = NCM_MONOFASICO.test(soDig(prod?.ncm));
  const v = { trib_fed: 0, pis: 0, cofins: 0, ir: 0, csll: 0, icms: 0 }, notas = [];
  if (c.regime === 'SIMPLES') {
    // Anexo I (comércio), faixa 1: ICMS = 34% do DAS; PIS + Cofins = 15,5% do DAS.
    let fr = 1; if (st) { fr -= 0.34; notas.push('ICMS já pago por substituição: sai a parte do ICMS do DAS'); } if (mono) { fr -= 0.155; notas.push('produto monofásico: sai a parte de PIS/Cofins'); }
    v.trib_fed = Math.round(c.simples * fr * 100) / 100; notas.unshift(`Simples ${String(c.simples).replace('.', ',')}% no campo Trib. federais`);
  } else if (c.regime === 'PRESUMIDO' || c.regime === 'REAL') {
    const pres = c.regime === 'PRESUMIDO';
    Object.assign(v, { pis: mono ? 0 : pres ? 0.65 : 1.65, cofins: mono ? 0 : pres ? 3 : 7.6, ir: pres ? 1.2 : 0, csll: pres ? 1.08 : 0, icms: st ? 0 : c.icms });
    if (mono) notas.push('produto monofásico: PIS/Cofins zerados na revenda'); if (st) notas.push('ICMS já pago por substituição');
    if (!pres) notas.push('no Lucro Real o IR e a CSLL são sobre o lucro do período (combine com o contador)');
  } else notas.push('no MEI os impostos são fixos no DAS mensal e não incidem sobre cada venda');
  return { valores: v, notas, regime: (REGIMES.find((r) => r[0] === c.regime) || [, c.regime])[1] };
}
// Sugestões para Grupo, Subgrupo e Classe (somadas às que já foram cadastradas).
const GRUPOS_SUGERIDOS = {
  'LIMPEZA': ['ÁGUA SANITÁRIA', 'ALVEJANTES', 'AMACIANTES', 'CERAS E LUSTRA-MÓVEIS', 'DESENGORDURANTES', 'DESINFETANTES', 'DETERGENTES', 'LIMPA VIDROS', 'LIMPADORES MULTIUSO', 'SABÃO EM BARRA', 'SABÃO EM PÓ', 'SABÃO LÍQUIDO', 'SAPONÁCEOS'],
  'HIGIENE': ['ÁLCOOL', 'ÁLCOOL EM GEL', 'PAPEL HIGIÊNICO', 'PAPEL TOALHA', 'SABONETES', 'GUARDANAPOS', 'LENÇOS'],
  'DESCARTÁVEIS': ['COPOS', 'PRATOS E TALHERES', 'SACOS DE LIXO', 'LUVAS', 'EMBALAGENS', 'TOUCAS E MÁSCARAS'],
  'UTENSÍLIOS': ['BALDES', 'DISPENSERS', 'ESPONJAS', 'PÁS E ESCOVAS', 'PANOS E FLANELAS', 'VASSOURAS E RODOS', 'LIXEIRAS'],
  'AROMATIZANTES': ['AROMATIZADORES', 'ODORIZADORES', 'PEDRAS SANITÁRIAS'],
  'PISCINA': ['CLORO', 'ALGICIDAS', 'CLARIFICANTES'],
};
const CLASSES_SUGERIDAS = ['LINHA DOMÉSTICA', 'LINHA PROFISSIONAL', 'LINHA INSTITUCIONAL', 'CONCENTRADO', 'PRONTO USO', 'REFIL'];
function calcPreco(custo, f) {
  const soma = (l) => l.reduce((s, k) => s + (Number(f[k]) || 0), 0);
  const custoFinal = (Number(custo) || 0) * (1 + (soma(P_ACRESC) - soma(P_CREDITOS)) / 100);
  const deducoes = soma(P_VENDA), fator = 1 - (deducoes + (Number(f.margem) || 0)) / 100;
  return { custoFinal: r2(custoFinal), deducoes, fator, preco: fator > 0 ? r2(custoFinal / fator) : 0, pmz: deducoes < 100 ? r2(custoFinal / (1 - deducoes / 100)) : 0 };
}
const ORIGENS = [['0', '0 - Nacional'], ['1', '1 - Estrangeira (importação direta)'], ['2', '2 - Estrangeira (mercado interno)'], ['3', '3 - Nacional, conteúdo importado 40% a 70%'], ['4', '4 - Nacional, processos básicos'], ['5', '5 - Nacional, importado até 40%'], ['6', '6 - Estrangeira sem similar (importação direta)'], ['7', '7 - Estrangeira sem similar (mercado interno)'], ['8', '8 - Nacional, importado acima de 70%']];
const CSOSNS = [['101', '101 - Tributada com crédito'], ['102', '102 - Tributada sem crédito (padrão MEI)'], ['103', '103 - Isenção por faixa de receita'], ['201', '201 - Com crédito e ST'], ['202', '202 - Sem crédito e com ST'], ['203', '203 - Isenção e ST'], ['300', '300 - Imune'], ['400', '400 - Não tributada'], ['500', '500 - ICMS cobrado antes por ST'], ['900', '900 - Outros']];
async function formProduto(p, depois) {
  p = p || {};
  const f = pricingPadrao(p);
  const codigos = [...(p.ean ? [p.ean] : []), ...(Array.isArray(p.barcodes) ? p.barcodes.filter((c) => c !== p.ean) : [])];
  const embalagens = Array.isArray(p.packages) ? p.packages.map((x) => ({ ...x })) : [];
  // Listas para sugerir fabricante, grupo, subgrupo e classe já usados.
  let listas = { brand: [], group_name: [], subgroup: [], class_name: [] }, pares = [];
  try { const rs = await ok(sb.from('products').select('brand,group_name,subgroup,class_name').limit(5000)); pares = rs.filter((r) => r.group_name && r.subgroup); Object.keys(listas).forEach((k) => (listas[k] = [...new Set(rs.map((r) => r[k]).filter(Boolean))].sort())); } catch { /* segue sem sugestões */ }
  // Código interno: dado pelo sistema (o próximo número livre), o usuário não digita.
  let proxCodigo = 'automático';
  if (!p.id) try { const n = await ok(sb.rpc('proximo_codigo_produto')); if (n) proxCodigo = n + ' (automático)'; } catch { /* mostra só "automático" */ }
  const dl = (id, l) => `<datalist id="${id}">${l.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const dec = (x) => (x == null || x === '' ? '' : String(x).replace('.', ','));
  const campo = (k) => P_VENDA.includes(k) ? `<div class="pc"><label>${CAMPOS_PRECO[k]} % 🔒</label><input data-pr="${k}" inputmode="decimal" value="${dec(f[k])}" readonly tabindex="-1" class="auto"></div>` : `<div class="pc"><label>${CAMPOS_PRECO[k]} %</label><input data-pr="${k}" inputmode="decimal" value="${dec(f[k])}"></div>`;
  // Grupo, subgrupo e classe: lista suspensa com sugestões + "Cadastrar novo".
  const uniq = (l) => [...new Set(l.filter(Boolean).map((x) => String(x).toUpperCase()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const opGrupos = () => uniq([...Object.keys(GRUPOS_SUGERIDOS), ...listas.group_name]);
  const opSub = (g) => uniq([...(GRUPOS_SUGERIDOS[String(g || '').toUpperCase()] || []), ...pares.filter((r) => !g || String(r.group_name).toUpperCase() === String(g).toUpperCase()).map((r) => r.subgroup), ...(g ? [] : listas.subgroup)]);
  const opClasse = () => uniq([...CLASSES_SUGERIDAS, ...listas.class_name]);
  const combo = (nome, valor, ops) => { const v = String(valor || '').toUpperCase(); const l = v && !ops.includes(v) ? [v, ...ops] : ops; return `<select name="${nome}" data-combo="${nome}"><option value="">— escolha —</option>${l.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="__novo">＋ Cadastrar novo…</option></select>`; };
  $('#form').innerHTML = `<div class="card ficha"><h2 style="margin-top:0">${p.id ? 'Editar produto ' + esc(p.code) : 'Novo produto'} <small style="color:var(--muted);font-weight:400">(campos com * são obrigatórios)</small></h2>
  <div class="abas-ficha"><button type="button" data-aba="dados" class="ativa">Dados do produto</button><button type="button" data-aba="preco">Formação de preço</button><button type="button" data-aba="trib">Tributos</button><button type="button" data-aba="emb">Códigos e embalagens</button></div>
  <form id="fp" novalidate>
  <div data-painel="dados">
    <div class="linha"><div style="flex:0 1 160px"><label>Código interno</label><input name="code" value="${esc(p.code || '')}" readonly tabindex="-1" class="auto" placeholder="${esc(proxCodigo)}" title="Gerado pelo sistema"></div><div style="flex:0 1 170px"><label>Cód. fabricante</label><input name="mfr_code" value="${esc(p.mfr_code)}"></div><div><label>Fabricante / marca *</label><input name="brand" list="dlMarca" value="${esc(p.brand)}"></div></div>
    <div class="linha"><div style="flex:3 1 300px"><label>Descrição *</label><input name="description" value="${esc(p.description)}"></div><div style="flex:2 1 220px"><label>Descrição PDV (curta)</label><input name="pdv_description" maxlength="40" value="${esc(p.pdv_description)}"></div></div>
    <div class="linha"><div><label>Grupo</label>${combo('group_name', p.group_name, opGrupos())}</div><div><label>Subgrupo</label><span id="boxSub">${combo('subgroup', p.subgroup, opSub(p.group_name))}</span></div><div><label>Classe</label>${combo('class_name', p.class_name, opClasse())}</div></div>
    <div class="linha"><div style="flex:0 1 150px"><label>Un. comercial *</label><input name="unit" value="${esc(p.unit || 'UND')}"></div><div style="flex:0 1 150px"><label>Un. tributável</label><input name="unit_tax" value="${esc(p.unit_tax || '')}" placeholder="igual à comercial"></div><div style="flex:0 1 130px"><label>Múltiplo de venda</label><input name="unit_multiple" inputmode="decimal" value="${dec(p.unit_multiple)}"></div><div style="flex:0 1 130px"><label>Estoque</label><input name="stock" inputmode="decimal" value="${dec(p.stock ?? 0)}"></div></div>
    <div class="linha"><div><label>Localizador</label><input name="location" value="${esc(p.location)}"></div><div><label>Prateleira</label><input name="shelf" value="${esc(p.shelf)}"></div><div><label>Último fornecedor</label><input value="${esc(p.last_supplier || '')}" disabled></div><div style="flex:0 1 200px"><label>Vlr. últ. compra</label><div class="com-botao"><input value="${p.last_purchase_price != null ? brl(p.last_purchase_price) : ''}" disabled>${p.id ? '<button type="button" class="btn mini" id="histCompras" title="Histórico de compras deste produto">＋</button>' : ''}</div></div></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--ink)"><input type="checkbox" name="inativo" style="width:auto" ${p.active === false ? 'checked' : ''}> Inativar produto (não aparece mais nos orçamentos)</label>
  </div>
  <div data-painel="preco" hidden>
    <div class="grade-preco">
      <div class="card"><h3>Custo</h3><div class="pc"><label>Custo R$ *</label><input name="cost" inputmode="decimal" value="${dec(p.cost)}"></div>
        <div class="pcs">${P_CREDITOS.map(campo).join('')}</div><div class="pcs">${P_ACRESC.map(campo).join('')}</div>
        <div class="pc destaque"><label>Custo final R$</label><input id="custoFinal" disabled></div></div>
      <div class="card"><h3>Preço de venda</h3><div class="pcs">${P_VENDA.map(campo).join('')}</div>
        <div class="pcs"><div class="pc"><label>M. lucro % *</label><input data-pr="margem" inputmode="decimal" value="${dec(f.margem)}"></div><div class="pc"><label>Fator mark-up</label><input id="fator" disabled></div></div>
        <div class="pcs"><div class="pc destaque"><label>Sugestão vlr. venda</label><input id="sugerido" disabled></div><div class="pc"><label>PMZ (sem lucro)</label><input id="pmz" disabled></div></div>
        <button type="button" class="btn" id="usarSug">Usar a sugestão como preço</button><p class="dica" id="notaImp" style="margin:10px 0 0"></p></div>
    </div>
    <div class="linha"><div style="flex:0 1 200px"><label>Preço de venda R$ *</label><input name="price" inputmode="decimal" value="${dec(p.price)}"></div><div style="flex:2 1 300px;align-self:flex-end"><p class="dica" id="lucros" style="margin:0"></p></div></div>
  </div>
  <div data-painel="trib" hidden>
    <div class="linha"><div style="flex:0 1 160px"><label>NCM (8 números)</label><input name="ncm" inputmode="numeric" maxlength="10" value="${esc(p.ncm)}"></div><div style="flex:0 1 160px"><label>CEST</label><input name="cest" inputmode="numeric" maxlength="9" value="${esc(p.cest)}"></div><div style="flex:0 1 120px"><label>CFOP</label><input name="cfop" inputmode="numeric" maxlength="4" value="${esc(p.cfop || '5102')}"></div></div>
    <div class="linha"><div><label>Origem da mercadoria</label><select name="origin">${ORIGENS.map(([v, t]) => `<option value="${v}" ${String(p.origin ?? '0') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label>CSOSN (Simples Nacional / MEI)</label><select name="cst">${CSOSNS.map(([v, t]) => `<option value="${v}" ${String(p.cst ?? '102') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <p class="dica">Estes dados serão usados na emissão da NF-e. Na dúvida sobre NCM e CEST, copie da nota de compra do fornecedor ou confirme com o contador.</p>
  </div>
  <div data-painel="emb" hidden>
    <h3 style="margin:4px 0">Códigos de barras (GTIN/EAN)</h3><div id="codigos"></div><div class="linha" style="margin-top:6px"><input id="novoCodigo" inputmode="numeric" placeholder="Digite ou leia o código de barras" style="flex:0 1 260px"><button type="button" class="btn" id="addCodigo" style="flex:0 0 auto">＋ Adicionar</button></div>
    <h3 style="margin:16px 0 4px">Embalagens de venda</h3><p style="color:var(--muted);font-size:13px;margin:0 0 6px">Ex.: CX com 12 unidades. O preço sugerido usa o custo × fator e a margem da embalagem.</p>
    <div class="tabela"><table><thead><tr><th>Código de barras</th><th>Un.</th><th class="num">Fator</th><th class="num">M.L. %</th><th class="num">Preço R$</th><th></th></tr></thead><tbody id="embs"></tbody></table></div>
    <button type="button" class="btn" id="addEmb" style="margin-top:6px">＋ Embalagem</button>
  </div>
  <div class="acoes"><button class="btn pri">Salvar</button><button type="button" class="btn" id="cancela">Cancelar</button>${p.id && ehAdmin() ? '<button type="button" class="btn perigo" id="apaga">Excluir</button>' : ''}</div>
  </form>${dl('dlMarca', listas.brand)}</div>`;
  $('#form').scrollIntoView({ behavior: 'smooth' });
  const fp = $('#fp');
  const abrir = (aba) => { $$('[data-aba]').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba)); $$('[data-painel]').forEach((d) => (d.hidden = d.dataset.painel !== aba)); };
  $$('[data-aba]').forEach((b) => (b.onclick = () => abrir(b.dataset.aba)));
  const lerPr = () => { $$('[data-pr]').forEach((i) => (f[i.dataset.pr] = num(i.value))); return f; };
  const calc = () => {
    const c = calcPreco(num(fp.cost.value), lerPr());
    $('#custoFinal').value = brl(c.custoFinal); $('#fator').value = c.fator.toFixed(4).replace('.', ','); $('#sugerido').value = c.fator > 0 ? brl(c.preco) : 'margem + deduções ≥ 100%'; $('#pmz').value = brl(c.pmz);
    const pv = num(fp.price.value);
    if (pv) { const bruto = pv - c.custoFinal, liq = bruto - pv * c.deducoes / 100; $('#lucros').innerHTML = `Lucro bruto: <b>${brl(bruto)}</b> (${((bruto / pv) * 100).toFixed(1).replace('.', ',')}%) · Lucro líquido: <b>${brl(liq)}</b> (${((liq / pv) * 100).toFixed(1).replace('.', ',')}%)${pv < c.pmz ? ' · <b style="color:var(--red)">abaixo do PMZ (prejuízo)</b>' : ''}`; }
    else $('#lucros').textContent = 'Informe o preço de venda (ou use a sugestão).';
    desenharEmb();
    return c;
  };
  $('#usarSug').onclick = () => { const c = calc(); if (c.preco) { fp.price.value = dec(c.preco); S.sujo = true; calc(); } };
  // Impostos da venda: recalculados quando muda o NCM ou o CSOSN (aba Tributos).
  const atualizarImpostos = () => {
    const im = impostosVenda({ ncm: fp.ncm.value, cst: fp.cst.value });
    Object.entries(im.valores).forEach(([k, v]) => { f[k] = v; const i = $(`[data-pr="${k}"]`); if (i) i.value = dec(v); });
    $('#notaImp').innerHTML = `🔒 Calculado pelo sistema · regime <b>${esc(im.regime)}</b>${im.notas.length ? ' · ' + im.notas.map(esc).join(' · ') : ''}. Custo operac., comissão, outros e enc. financ. seguem o <b>Admin › Formação de preços</b>.`;
    calc();
  };
  fp.ncm.addEventListener('input', atualizarImpostos); fp.cst.addEventListener('change', atualizarImpostos);
  // Grupo / subgrupo / classe: "＋ Cadastrar novo…" pede o nome e já deixa escolhido.
  const ROT_COMBO = { group_name: 'grupo', subgroup: 'subgrupo', class_name: 'classe' };
  const ligarCombo = (sel) => {
    let ant = sel.value;
    sel.onchange = async () => {
      if (sel.value === '__novo') {
        const r = await dialogo(`<h2 style="margin-top:0">Cadastrar ${ROT_COMBO[sel.name]}</h2><label>Nome do ${ROT_COMBO[sel.name]}</label><input id="dNovo" maxlength="40">`, 'Adicionar', () => $('#dNovo').value.trim().toUpperCase(), () => setTimeout(() => $('#dNovo').focus(), 30));
        if (!r) { sel.value = ant; return; }
        if (![...sel.options].some((o) => o.value === r)) sel.add(new Option(r, r), sel.options[sel.options.length - 1]);
        sel.value = r;
      }
      ant = sel.value; S.sujo = true;
      if (sel.name === 'group_name') { $('#boxSub').innerHTML = combo('subgroup', '', opSub(sel.value)); ligarCombo(fp.subgroup); }
    };
  };
  $$('#fp [data-combo]').forEach(ligarCombo);
  // (+) Histórico das compras anteriores do produto.
  if ($('#histCompras')) $('#histCompras').onclick = async () => {
    try {
      const h = await ok(sb.rpc('historico_compras', { p_product: p.id }));
      await dialogo(`<h2 style="margin-top:0">Histórico de compras</h2><p style="color:var(--muted);margin-top:0">${esc(p.code)} · ${esc(p.description)}</p>
        ${h.length ? `<div class="tabela"><table><thead><tr><th>Data</th><th>NF</th><th>Fornecedor</th><th class="num">Qtd</th><th class="num">Custo na nota</th><th class="num">Custo / un.</th><th>Lote · validade</th></tr></thead><tbody>
        ${h.map((x) => `<tr><td>${dataBR(x.data)}</td><td>${esc(x.nota || '')}</td><td>${esc(x.fornecedor || '')}</td><td class="num">${dec(x.quantidade)} ${esc(x.unidade || '')}${Number(x.fator) > 1 ? ' ×' + dec(x.fator) : ''}</td><td class="num">${brl(x.custo_nota)}</td><td class="num"><b>${brl(x.custo_unidade)}</b></td><td><small>${esc(x.lote || '—')}${x.validade ? ' · ' + dataBR(x.validade) : ''}</small></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="vazio">Nenhuma compra registrada para este produto. As compras entram pela entrada de nota fiscal.</p>'}`, 'Fechar', null, () => $('.fundo-dialogo:last-child .dialogo').classList.add('largo'));
    } catch (e) { falhou(e); }
  };
  [...$$('[data-pr]'), fp.cost, fp.price].forEach((i) => i.addEventListener('input', calc));
  // Códigos de barras
  const desenharCodigos = () => { $('#codigos').innerHTML = codigos.map((c, k) => `<span class="chip">${esc(c)}${k === 0 ? ' <small>(principal)</small>' : ''} <a href="#" data-xc="${k}" style="color:var(--red);text-decoration:none">✕</a></span>`).join(' ') || '<p class="vazio" style="padding:4px">Nenhum código de barras.</p>'; $$('[data-xc]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); codigos.splice(a.dataset.xc, 1); S.sujo = true; desenharCodigos(); })); };
  $('#addCodigo').onclick = () => { const c = soDig($('#novoCodigo').value); if (c.length < 8) return aviso('Código de barras precisa ter de 8 a 14 números.', true); if (!codigos.includes(c)) codigos.push(c); $('#novoCodigo').value = ''; S.sujo = true; desenharCodigos(); };
  $('#novoCodigo').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#addCodigo').click(); } };
  // Embalagens de venda
  function desenharEmb() {
    const custo = num(fp.cost.value);
    $('#embs').innerHTML = embalagens.map((x, k) => { const sug = calcPreco(custo * (num(x.factor) || 1), { ...f, margem: x.margin ?? f.margem }).preco; return `<tr data-e="${k}"><td><input data-ec="ean" value="${esc(x.ean || '')}" inputmode="numeric" style="width:150px"></td><td><input data-ec="unit" value="${esc(x.unit || '')}" style="width:70px"></td><td class="num"><input data-ec="factor" value="${dec(x.factor)}" inputmode="decimal" style="width:70px"></td><td class="num"><input data-ec="margin" value="${dec(x.margin ?? f.margem)}" inputmode="decimal" style="width:70px"></td><td class="num"><input data-ec="price" value="${dec(x.price)}" inputmode="decimal" style="width:100px" placeholder="${dec(sug)}"><br><small style="color:var(--muted)">sug. ${brl(sug)}</small></td><td><button type="button" class="btn perigo" data-xe="${k}" style="padding:3px 8px">✕</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="vazio">Nenhuma embalagem além da unidade.</td></tr>';
    $$('#embs [data-ec]').forEach((i) => (i.onchange = () => { const x = embalagens[i.closest('[data-e]').dataset.e]; x[i.dataset.ec] = ['factor', 'margin', 'price'].includes(i.dataset.ec) ? num(i.value) : i.value.trim().toUpperCase(); calc(); }));
    $$('#embs [data-xe]').forEach((b) => (b.onclick = () => { embalagens.splice(b.dataset.xe, 1); S.sujo = true; desenharEmb(); }));
  }
  $('#addEmb').onclick = () => { embalagens.push({ unit: 'CX', factor: 12, margin: f.margem, ean: '', price: null }); S.sujo = true; desenharEmb(); };
  desenharCodigos(); atualizarImpostos();
  $('#cancela').onclick = () => ($('#form').innerHTML = '');
  if ($('#apaga')) $('#apaga').onclick = async () => { if (!confirm('Excluir este produto?')) return; try { await ok(sb.from('products').delete().eq('id', p.id)); aviso('Produto excluído.'); $('#form').innerHTML = ''; depois(); } catch (e) { falhou(e); } };
  fp.onsubmit = async (e) => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(fp)); lerPr();
    // Obrigatórios: mostra a aba onde falta e marca o campo em vermelho.
    const obrig = [['brand', 'dados', 'fabricante'], ['description', 'dados', 'descrição'], ['unit', 'dados', 'unidade'], ['cost', 'preco', 'custo'], ['price', 'preco', 'preço de venda']];
    $$('#fp .falta').forEach((i) => i.classList.remove('falta'));
    const faltam = obrig.filter(([n]) => !String(d[n] ?? '').trim() || (['cost', 'price'].includes(n) && !num(d[n])));
    if (faltam.length) { faltam.forEach(([n]) => fp[n].classList.add('falta')); abrir(faltam[0][1]); return aviso('Preencha: ' + faltam.map((x) => x[2]).join(', '), true); }
    const ncm = soDig(d.ncm); if (ncm && ncm.length !== 8) { abrir('trib'); fp.ncm.classList.add('falta'); return aviso('O NCM precisa ter 8 números.', true); }
    const reg = {
      ...(p.id ? {} : { code: null }), mfr_code: d.mfr_code.trim() || null, description: d.description.trim().toUpperCase(), pdv_description: d.pdv_description.trim().toUpperCase() || null,
      brand: d.brand.trim().toUpperCase(), group_name: d.group_name.trim().toUpperCase() || null, subgroup: d.subgroup.trim().toUpperCase() || null, class_name: d.class_name.trim().toUpperCase() || null,
      unit: d.unit.trim().toUpperCase(), unit_tax: d.unit_tax.trim().toUpperCase() || null, unit_multiple: d.unit_multiple ? num(d.unit_multiple) : null, stock: num(d.stock),
      location: d.location.trim() || null, shelf: d.shelf.trim() || null, active: !d.inativo,
      cost: num(d.cost), price: num(d.price), pricing: { ...f }, freight_pct: f.frete, tax_pct: r2((Number(f.ipi) || 0) + (Number(f.st) || 0)), other_pct: f.outros_c, margin_pct: f.margem,
      ncm: ncm || null, cest: soDig(d.cest) || null, cfop: soDig(d.cfop) || null, origin: d.origin, cst: d.cst,
      ean: codigos[0] || null, barcodes: codigos.length ? codigos : null, packages: embalagens.length ? embalagens.map((x) => ({ ean: soDig(x.ean) || null, unit: x.unit || 'CX', factor: num(x.factor) || 1, margin: x.margin ?? f.margem, price: x.price || calcPreco(num(d.cost) * (num(x.factor) || 1), { ...f, margem: x.margin ?? f.margem }).preco })) : null,
      updated_at: new Date().toISOString(),
    };
    try {
      const salvo = await ok(p.id ? sb.from('products').update(reg).eq('id', p.id).select('code').single() : sb.from('products').insert(reg).select('code').single());
      aviso(p.id ? 'Produto salvo.' : `Produto salvo com o código ${salvo.code}.`); $('#form').innerHTML = ''; depois();
    }
    catch (err) { falhou(String(err.message || err).includes('products_code_key') ? 'já existe um produto com este código interno' : err); }
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

// ---------- clientes ----------
const formatarDoc = (c) => (c.length === 11 ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : c.length === 14 ? c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : c);
async function buscarClientes(t, limite = 50) {
  let q = sb.from('clients').select('*').order('name').limit(limite);
  t = limpaBusca(t);
  if (t) {
    const f = [`name.ilike.%${t}%`, `email.ilike.%${t}%`, `phone.ilike.%${t}%`, `doc.ilike.%${t}%`];
    const d = soDig(t);
    if (d && d.length <= 6) f.push(`code.eq.${Number(d)}`);
    if (d.length >= 3) f.push(`doc.ilike.%${formatarDoc(d)}%`);
    q = q.or(f.join(','));
  }
  return ok(q);
}
async function clientePorDoc(dig) {
  if (!dig) return null;
  const cs = await ok(sb.from('clients').select('*').or(`doc.eq.${dig},doc.eq.${formatarDoc(dig)}`).limit(1));
  return cs[0] || null;
}
// Dados públicos do CNPJ: BrasilAPI (nome e situação) + CNPJ.ws (e-mail e telefone, que a BrasilAPI quase nunca traz).
async function buscarCnpj(c) {
  try {
    const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + c); if (!r.ok) return null;
    const d = await r.json();
    let email = d.email, fone = d.ddd_telefone_1;
    if (!email || !fone) {
      try { const e = (await (await fetch('https://publica.cnpj.ws/cnpj/' + c)).json()).estabelecimento || {}; email = email || e.email; fone = fone || (e.telefone1 ? (e.ddd1 || '') + e.telefone1 : ''); } catch { /* segue */ }
    }
    return { nome: d.razao_social || d.nome_fantasia || '', email: email ? String(email).toLowerCase() : '', fone: fone ? String(fone).replace(/\D/g, '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '', situacao: (d.descricao_situacao_cadastral || 'encontrado').toLowerCase(), endereco: [d.logradouro, d.numero, d.bairro, d.municipio && d.municipio + '-' + d.uf].filter(Boolean).join(', ') };
  } catch { return null; }
}
// Cria o cliente (o banco gera o código) ou atualiza o cadastro existente. Se o CPF/CNPJ já existir, reaproveita.
async function salvarCliente(id, dados) {
  if (!id && dados.doc) { const ja = await clientePorDoc(soDig(dados.doc)); if (ja) id = ja.id; }
  if (id) return ok(sb.from('clients').update(dados).eq('id', id).select('id,code').single());
  return ok(sb.from('clients').insert(dados).select('id,code').single());
}
// Clientes: abre só com dois botões grandes; o formulário ou a lista aparecem depois do clique.
async function telaClientes(modo) {
  app.innerHTML = `${secao('clientes', '#/clientes/' + modo)}
  <div id="form"></div>
  ${modo === 'lista' ? `<div class="linha"><input id="busca" placeholder="Buscar por nome, código, CPF/CNPJ, telefone ou e-mail"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Cód.</th><th>Nome / Razão social</th><th class="esconde-cel">CPF / CNPJ</th><th>Telefone</th><th class="esconde-cel">E-mail</th></tr></thead><tbody id="lista"></tbody></table></div>` : ''}`;
  if (modo === 'novo') { formCliente(null, () => (location.hash = '#/clientes/lista'), () => (location.hash = '#/clientes')); setTimeout(() => $('#cdoc') && $('#cdoc').focus(), 50); return; }
  if (modo !== 'lista') return;
  const carregar = async () => {
    const cs = await buscarClientes($('#busca').value, 300);
    $('#lista').innerHTML = cs.map((c) => `<tr class="clica" data-id="${c.id}"><td><b>${c.code}</b></td><td>${esc(c.name)}</td><td class="esconde-cel">${esc(c.doc || '')}</td><td>${esc(c.phone || '')}</td><td class="esconde-cel">${esc(c.email || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum cliente.</td></tr>';
    $$('#lista tr[data-id]').forEach((tr) => (tr.onclick = () => formCliente(cs.find((c) => c.id === tr.dataset.id), carregar)));
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); };
  carregar(); $('#busca').focus();
}
function formCliente(c, depois, aoCancelar) {
  c = c || {};
  $('#form').innerHTML = `<div class="card"><h2 style="margin-top:0">${c.id ? 'Cliente ' + c.code : 'Novo cliente'} <small style="color:var(--muted);font-weight:400">${c.id ? '' : '(o código é gerado ao salvar)'}</small></h2><form id="fc">
    <div class="linha"><div><label>CPF ou CNPJ <small id="docst"></small></label><input name="doc" id="cdoc" value="${esc(c.doc)}" inputmode="numeric"></div><div style="flex:2 1 260px"><label>Nome / Razão social</label><input name="name" id="cnome" required value="${esc(c.name)}"></div></div>
    <div class="linha"><div><label>Telefone / WhatsApp</label><input name="phone" id="cfone" value="${esc(c.phone)}" inputmode="tel"></div><div><label>E-mail</label><input name="email" id="cemail" type="email" value="${esc(c.email)}"></div></div>
    <label>Endereço</label><input name="address" id="cend" value="${esc(c.address)}">
    <label>Observações</label><textarea name="notes">${esc(c.notes)}</textarea>
    <div class="acoes"><button class="btn pri">Salvar</button>${c.id ? `<a class="btn" href="#/orcamento/novo?cliente=${c.code}">Novo orçamento para este cliente</a>` : ''}<button type="button" class="btn" id="cancela">Cancelar</button>${c.id && ehAdmin() ? '<button type="button" class="btn perigo" id="apaga">Excluir</button>' : ''}</div></form></div>`;
  $('#form').scrollIntoView({ behavior: 'smooth' });
  $('#cancela').onclick = () => (aoCancelar ? aoCancelar() : ($('#form').innerHTML = ''));
  $('#cdoc').oninput = async () => {
    const d = soDig($('#cdoc').value); if (d.length !== 11 && d.length !== 14) return;
    $('#cdoc').value = formatarDoc(d);
    const ja = await clientePorDoc(d); if (ja && ja.id !== c.id) { $('#docst').textContent = '· já cadastrado: código ' + ja.code; return; }
    if (d.length === 14 && !c.id) { $('#docst').textContent = '· buscando…'; const r = await buscarCnpj(d); if (!r) { $('#docst').textContent = '· não encontrado'; return; } $('#cnome').value = r.nome.toUpperCase(); if (r.fone) $('#cfone').value = r.fone; if (r.email) $('#cemail').value = r.email; if (r.endereco) $('#cend').value = r.endereco; $('#docst').textContent = '· ' + r.situacao; }
  };
  if ($('#apaga')) $('#apaga').onclick = async () => { if (!confirm('Excluir o cliente ' + c.code + '? Os orçamentos dele continuam.')) return; try { await ok(sb.from('clients').delete().eq('id', c.id)); $('#form').innerHTML = ''; depois(); } catch (e) { falhou(e); } };
  $('#fc').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    Object.keys(f).forEach((k) => (f[k] = f[k].trim() || null)); if (f.email) f.email = f.email.toLowerCase(); if (f.name) f.name = f.name.toUpperCase();
    try { const r = await salvarCliente(c.id, f); aviso('Cliente ' + r.code + ' salvo.'); $('#form').innerHTML = ''; depois(); } catch (err) { falhou(String(err.message || err).includes('clients_doc_unico') ? 'esse CPF/CNPJ já está cadastrado' : err); }
  };
}

// ---------- orçamento: editor ----------
async function telaEditorOrcamento(id, codCliente) {
  let q = { client_name: '', client_doc: '', client_phone: '', client_email: '', observations: '', discount_percent: 0 }, itens = [];
  if (id) {
    q = await ok(sb.from('quotes').select('*').eq('id', id).single());
    if (q.status === 'vendido') { aviso('Orçamento já vendido não pode ser editado.', true); location.hash = '#/orcamento/' + id; return; }
    itens = await ok(sb.from('quote_items').select('*').eq('quote_id', id).order('description'));
  }
  app.innerHTML = `${barraVoltar(id ? 'Editar orçamento nº ' + esc(q.number) : 'Novo orçamento', '#/orcamentos')}
  <div class="card"><h2 style="margin-top:0">Cliente</h2>
    <div class="linha"><div style="flex:0 1 150px"><label>Cód. cliente <small id="codst"></small></label><input id="ccod" value="${q.client_code || ''}" inputmode="numeric" placeholder="Ex.: 101"></div>
    <div style="flex:3 1 300px;position:relative"><label>Buscar cliente cadastrado</label><input id="bcli" placeholder="Digite nome, código, CPF/CNPJ ou telefone"><div id="sugcli"></div></div></div>
    <div class="linha">
    <div><label>CPF ou CNPJ <small id="docst"></small></label><input id="doc" value="${esc(q.client_doc)}" inputmode="numeric" placeholder="Só números"></div>
    <div style="flex:2 1 260px"><label>Nome / Razão social</label><input id="nome" value="${esc(q.client_name)}"></div></div>
    <div class="linha"><div><label>Telefone / WhatsApp</label><input id="fone" value="${esc(q.client_phone)}" inputmode="tel"></div><div><label>E-mail</label><input id="email" value="${esc(q.client_email)}" type="email"></div></div>
    <div style="margin-top:10px"><button type="button" class="btn" id="obsBtn" title="Informação adicional que sai no PDF">📝 Informação adicional</button></div>
    <div id="obsBox" ${q.observations ? '' : 'hidden'}><label>📝 Informação adicional (sai no PDF)</label><textarea id="obs" placeholder="Ex.: entrega na sexta pela manhã, pagamento em 2x, falar com Maria…">${esc(q.observations)}</textarea></div></div>
  <p class="vazio card" id="avisoCli">👆 Preencha o cliente (código, busca ou nome) para adicionar os produtos.</p>
  <div id="etapaProd" hidden>
  <div class="card"><h2 style="margin-top:0">Produtos</h2><input id="bp" placeholder="Palavras-chave do produto (ex.: detergente 5l) • do mais barato ao mais caro"><div id="sug"></div>
    <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Produto</th><th>Qtd</th><th>Preço un.</th><th class="num">Total</th><th></th></tr></thead><tbody id="carrinho"></tbody></table></div>
    <div class="linha" style="margin-top:12px"><div><label>Desconto (%)</label><input id="desc" inputmode="decimal" value="${String(q.discount_percent || 0).replace('.', ',')}"></div><div class="total" id="tot"></div></div></div>
  <div class="acoes"><button class="btn pri grande" id="salvar">Salvar orçamento</button></div></div>`;
  // Os produtos só aparecem depois que o cliente estiver preenchido (nome com pelo menos 3 letras).
  const etapa = () => { const okCli = $('#nome').value.trim().length >= 3; const antes = $('#etapaProd').hidden; $('#etapaProd').hidden = !okCli; $('#avisoCli').hidden = okCli; if (antes && okCli && !id) setTimeout(() => $('#bp').focus(), 50); };
  $('#nome').addEventListener('input', etapa);
  $('#obsBtn').onclick = () => { $('#obsBox').hidden = !$('#obsBox').hidden; if (!$('#obsBox').hidden) $('#obs').focus(); };

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
      const ps = await buscarProdutos(termo, 25);
      $('#sug').innerHTML = ps.length ? `<div class="sugestoes">${ps.map((p) => `<div data-id="${p.id}"><b>${esc(p.description)}</b><br><small>${esc(p.code)} · ${esc(p.brand || '')} · estoque ${p.stock} · ${brl(p.price)}</small></div>`).join('')}</div>` : '<p class="vazio">Nada encontrado.</p>';
      $$('#sug [data-id]').forEach((d) => (d.onclick = () => {
        const p = ps.find((x) => x.id === d.dataset.id);
        const ja = itens.find((i) => i.product_id === p.id);
        if (ja) ja.quantity += 1; else itens.push({ product_id: p.id, code: p.code, description: p.description, brand: p.brand, unit: p.unit, quantity: 1, unit_price: Number(p.price) });
        $('#bp').value = ''; $('#sug').innerHTML = ''; desenhar(); $('#bp').focus();
      }));
    }, 250);
  };
  // Cliente: pelo código, pela busca (nome, código, CPF/CNPJ, telefone) ou pelo CNPJ (cadastro ou Receita).
  let clienteId = q.client_id || null;
  const preencher = (c) => {
    clienteId = c.id; $('#ccod').value = c.code; $('#nome').value = c.name || ''; $('#doc').value = c.doc || '';
    $('#fone').value = c.phone || ''; $('#email').value = c.email || ''; $('#codst').textContent = '· ok'; $('#bcli').value = ''; $('#sugcli').innerHTML = '';
    etapa();
  };
  let tc;
  $('#ccod').oninput = () => {
    clearTimeout(tc); const cod = soDig($('#ccod').value); $('#codst').textContent = '';
    if (!cod) { clienteId = null; return; }
    tc = setTimeout(async () => {
      const c = await ok(sb.from('clients').select('*').eq('code', Number(cod)).maybeSingle());
      if (c) preencher(c); else { clienteId = null; $('#codst').textContent = '· não encontrado'; }
    }, 350);
  };
  let tb;
  $('#bcli').oninput = () => {
    clearTimeout(tb);
    tb = setTimeout(async () => {
      const cs = await buscarClientes($('#bcli').value, 10);
      if (!$('#bcli').value.trim()) return ($('#sugcli').innerHTML = '');
      $('#sugcli').innerHTML = cs.length ? `<div class="sugestoes">${cs.map((c) => `<div data-id="${c.id}"><b>${c.code} · ${esc(c.name)}</b><br><small>${esc(c.doc || 'sem CPF/CNPJ')} · ${esc(c.phone || '')}</small></div>`).join('')}</div>` : '<p class="vazio" style="padding:8px">Nenhum cliente encontrado. Preencha os dados abaixo que ele é cadastrado ao salvar.</p>';
      $$('#sugcli [data-id]').forEach((d) => (d.onclick = () => preencher(cs.find((x) => x.id === d.dataset.id))));
    }, 250);
  };
  // CNPJ/CPF: se já for cliente, puxa o cadastro; se for CNPJ novo, busca na Receita.
  let ultimoDoc = soDig(q.client_doc);
  $('#doc').oninput = async () => {
    const c = soDig($('#doc').value), st = $('#docst');
    if (c.length !== 11 && c.length !== 14) { st.textContent = ''; return; }
    $('#doc').value = formatarDoc(c);
    if (c === ultimoDoc) return; ultimoDoc = c;
    const ja = await clientePorDoc(c);
    if (ja) { preencher(ja); st.textContent = '· cliente já cadastrado'; return; }
    clienteId = null; $('#ccod').value = '';
    if (c.length === 11) { st.textContent = '· CPF'; return; }
    st.textContent = '· buscando…';
    const d = await buscarCnpj(c);
    if (!d) { st.textContent = '· CNPJ não encontrado'; return; }
    $('#nome').value = d.nome.toUpperCase(); if (d.email) $('#email').value = d.email; if (d.fone) $('#fone').value = d.fone;
    st.textContent = '· ' + d.situacao; etapa();
  };
  etapa();
  if (codCliente) { const c = await ok(sb.from('clients').select('*').eq('code', Number(codCliente)).maybeSingle()); if (c) preencher(c); }
  $('#salvar').onclick = async () => {
    if (!$('#nome').value.trim()) return aviso('Informe o nome do cliente.', true);
    if (!itens.length) return aviso('Adicione pelo menos um produto.', true);
    const b = $('#salvar'); b.disabled = true;
    const pct = num($('#desc').value), bruto = itens.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const reg = { client_name: $('#nome').value.trim().toUpperCase(), client_doc: $('#doc').value.trim(), client_phone: $('#fone').value.trim(), client_email: $('#email').value.trim(), observations: $('#obs').value.trim(), discount_percent: pct, total: r2(bruto * (1 - pct / 100)), items_count: itens.length, status: 'finalizado' };
    try {
      // Garante o cadastro do cliente (cria com código novo ou atualiza os dados) antes de gravar o orçamento.
      const cli = await salvarCliente(clienteId, { name: reg.client_name, doc: reg.client_doc || null, phone: reg.client_phone || null, email: reg.client_email || null });
      reg.client_id = cli.id; reg.client_code = cli.code;
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
  app.innerHTML = `${barraVoltar('Orçamento nº ' + esc(q.number) + ' ' + statusSelo(q.status), '#/orcamentos')}
  <div class="acoes topo">
    <button class="btn azul" id="pdf">PDF do orçamento</button>
    <a class="btn" target="_blank" href="https://wa.me/${soDig(q.client_phone).length >= 10 ? '55' + soDig(q.client_phone).replace(/^55/, '') : ''}?text=${encodeURIComponent('Olá! Segue o orçamento nº ' + q.number + ' da HIGIVARO: ' + link)}">Enviar no WhatsApp</a>
    <button class="btn" id="copiar">Copiar link</button>
    ${q.status !== 'vendido' ? '<a class="btn" href="#/orcamento/' + id + '/editar">Editar</a><button class="btn pri" id="vender">Confirmar venda</button>' : venda ? `<a class="btn" href="#/venda/${venda.id}">Ver venda nº ${esc(venda.number)}</a>` : ''}
    <button class="btn" id="obsBtn" title="Informação adicional que sai no PDF">📝 Informação adicional</button>
    ${ehAdmin() && q.status !== 'vendido' ? '<button class="btn perigo" id="apagar">Excluir</button>' : ''}
  </div>
  <div class="card">${q.client_code ? `<span class="selo">cliente ${q.client_code}</span> ` : ""}<b>${esc(q.client_name)}</b> ${q.client_doc ? '· ' + esc(q.client_doc) : ''}<br>${esc(q.client_phone || '')} ${esc(q.client_email || '')}<br><small style="color:var(--muted)">${dataBR(q.date)} ${esc(q.time)} · por ${esc(q.employee_name || '')}</small></div>
  ${q.observations ? `<div class="card obs-doc"><b>📝 Informação adicional</b> <small>(sai no PDF)</small><p>${esc(q.observations)}</p></div>` : ''}
  ${tabelaItens(itens, q.discount_percent)}
  ${logs.length ? `<h2>Histórico de edições</h2><div class="card">${logs.map((l) => `${new Date(l.created_at).toLocaleString('pt-BR')} · ${esc(l.editor_name)} · ${brl(l.total)}`).join('<br>')}</div>` : ''}`;
  $('#pdf').onclick = () => pdfDocumento('ORÇAMENTO', q, itens).catch(falhou);
  $('#copiar').onclick = () => navigator.clipboard.writeText(link).then(() => aviso('Link copiado.'), () => prompt('Copie o link:', link));
  if ($('#vender')) $('#vender').onclick = () => confirmarVenda(q, itens);
  $('#obsBtn').onclick = async () => {
    const r = await editarObs(q.observations, 'orçamento'); if (r === null) return;
    try { await ok(sb.from('quotes').update({ observations: r || null }).eq('id', id)); aviso('Informação salva.'); telaOrcamento(id); } catch (e) { falhou(e); }
  };
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
  // Janela de confirmação: forma de pagamento, se já foi recebido e vencimento (para o "a receber").
  const venc30 = new Date(Date.now() + 30 * 864e5).toLocaleDateString('sv-SE');
  const r = await dialogo(`<h2 style="margin-top:0">Confirmar venda do orçamento nº ${esc(q.number)}</h2>
    <p><b>${esc(q.client_name)}</b> · total <b>${brl(q.total)}</b><br><small style="color:var(--muted)">O estoque será baixado.</small></p>
    ${falta.length ? `<p style="color:var(--red)"><b>Atenção, estoque insuficiente:</b><br>${falta.map((i) => '• ' + esc(i.description)).join('<br>')}</p>` : ''}
    <label>Forma de pagamento</label><select id="dForma">${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--ink)"><input type="checkbox" id="dPago" style="width:auto"> Já foi recebido (pago agora)</label>
    <div id="dVencBox"><label>Vencimento (fica em "a receber" até ser pago)</label><input type="date" id="dVenc" value="${venc30}"></div>`,
    'Confirmar venda', () => ({ forma: $('#dForma').value, pago: $('#dPago').checked, venc: $('#dVenc').value }),
    () => { const sinc = () => { const avista = ['Pix', 'Dinheiro', 'Cartão de débito'].includes($('#dForma').value); $('#dPago').checked = avista; $('#dVencBox').hidden = $('#dPago').checked; }; $('#dForma').onchange = sinc; $('#dPago').onchange = () => ($('#dVencBox').hidden = $('#dPago').checked); sinc(); });
  if (!r) return;
  try { const vid = await ok(sb.rpc('registrar_venda', { p_quote: q.id, p_forma: r.forma, p_pago: r.pago, p_vencimento: r.pago ? hoje() : r.venc || hoje() })); aviso('Venda registrada.'); location.hash = '#/venda/' + vid; } catch (e) { falhou(e); }
}
const FORMAS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'A prazo (fiado)', 'Transferência'];
// Janela simples sobre a tela; devolve o que `ler()` retornar, ou null se cancelar.
function dialogo(html, rotuloOk, ler, aoAbrir) {
  return new Promise((fim) => {
    const fundo = document.createElement('div'); fundo.className = 'fundo-dialogo';
    fundo.innerHTML = `<div class="card dialogo">${html}<div class="acoes"><button class="btn pri" id="dOk">${rotuloOk}</button><button class="btn" id="dCancela">Cancelar</button></div></div>`;
    document.body.appendChild(fundo); if (aoAbrir) aoAbrir();
    const fechar = (v) => { fundo.remove(); fim(v); };
    $('#dCancela').onclick = () => fechar(null);
    fundo.onclick = (e) => { if (e.target === fundo) fechar(null); };
    $('#dOk').onclick = () => { const v = ler ? ler() : true; if (v !== undefined) fechar(v); }; // undefined = algo faltando, a janela fica aberta
  });
}
const diasAtraso = (venc) => Math.floor((new Date(hoje()) - new Date(String(venc).slice(0, 10))) / 864e5);
// Texto claro do prazo: "Vencida há 3 dias", "Vence hoje" ou "Faltam 34 dias".
const textoPrazo = (venc) => { const d = diasAtraso(venc); return d > 0 ? `Vencida há ${d} ${d === 1 ? 'dia' : 'dias'}` : d === 0 ? 'Vence hoje' : `Faltam ${-d} ${d === -1 ? 'dia' : 'dias'}`; };
const seloPagamento = (v) => v.status !== 'confirmada' ? '' : v.payment_status === 'recebido' ? '<span class="selo recebido">recebido</span>' : diasAtraso(v.due_date) > 0 ? `<span class="selo vencido">${textoPrazo(v.due_date).toLowerCase()}</span>` : `<span class="selo aberto">a receber · ${textoPrazo(v.due_date).toLowerCase()}</span>`;
async function telaOrcamentos(modo) {
  app.innerHTML = `${secao('orcamentos', '#/orcamentos/' + modo)}<div class="linha"><input id="busca" placeholder="Buscar cliente ou número"><select id="st" style="flex:0 1 180px"><option value="">Todos</option><option>finalizado</option><option>vendido</option><option>rascunho</option></select></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Nº</th><th>Cliente</th><th class="esconde-cel">Data</th><th class="esconde-cel">Vendedor</th><th class="num">Total</th><th>Status</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  const carregar = async () => {
    let qy = sb.from('quotes').select('*').order('created_at', { ascending: false }).limit(200);
    const t = limpaBusca($('#busca').value); if (t) qy = qy.or(`client_name.ilike.%${t}%,number.ilike.%${t}%` + (/^[0-9]{1,4}$/.test(t) ? `,client_code.eq.${t}` : ""));
    if ($('#st').value) qy = qy.eq('status', $('#st').value); else if (modo === 'abertos') qy = qy.neq('status', 'vendido');
    const qs = await ok(qy);
    $('#lista').innerHTML = qs.map((q) => `<tr class="clica" onclick="location.hash='#/orcamento/${q.id}'"><td>${esc(q.number)}</td><td>${q.client_code ? `<small style="color:var(--muted)">${q.client_code}</small> ` : ""}${esc(q.client_name)}</td><td class="esconde-cel">${dataBR(q.date)}</td><td class="esconde-cel">${esc(q.employee_name || '')}</td><td class="num">${brl(q.total)}</td><td>${statusSelo(q.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum orçamento.</td></tr>';
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); }; $('#st').onchange = carregar; carregar();
}

// ---------- vendas ----------
async function telaVendas(modo) {
  app.innerHTML = `${secao('vendas', '#/vendas/' + modo)}<div class="linha"><input id="busca" placeholder="Buscar cliente ou número"><input id="mes" type="month" value="${modo === 'devolvidas' ? '' : hoje().slice(0, 7)}" style="flex:0 1 180px"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Nº</th><th>Cliente</th><th class="esconde-cel">Data</th><th class="esconde-cel">Vendedor</th><th class="num">Total</th><th>Status</th></tr></thead><tbody id="lista"></tbody></table></div><p class="total" id="soma"></p>`;
  const carregar = async () => {
    const m = $('#mes').value; let qy = sb.from('sales').select('*').order('created_at', { ascending: false }).limit(500);
    if (modo === 'devolvidas') qy = qy.eq('status', 'devolvida');
    if (m) { const [y, mm] = m.split('-').map(Number); qy = qy.gte('date', m + '-01').lte('date', m + '-' + new Date(y, mm, 0).getDate()); }
    const t = limpaBusca($('#busca').value); if (t) qy = qy.or(`client_name.ilike.%${t}%,number.ilike.%${t}%` + (/^[0-9]{1,4}$/.test(t) ? `,client_code.eq.${t}` : ""));
    const vs = await ok(qy);
    $('#lista').innerHTML = vs.map((v) => `<tr class="clica" onclick="location.hash='#/venda/${v.id}'"><td>${esc(v.number)}</td><td>${v.client_code ? `<small style="color:var(--muted)">${v.client_code}</small> ` : ""}${esc(v.client_name)}</td><td class="esconde-cel">${dataBR(v.date)}</td><td class="esconde-cel">${esc(v.employee_name || '')}</td><td class="num">${brl(v.total)}</td><td>${statusSelo(v.status)} ${seloPagamento(v)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma venda.</td></tr>';
    $('#soma').textContent = 'Total confirmado: ' + brl(vs.filter((v) => v.status === 'confirmada').reduce((s, v) => s + Number(v.total), 0));
  };
  let t; $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); }; $('#mes').onchange = carregar; carregar();
}
async function telaVenda(id) {
  const [v, itens] = await Promise.all([ok(sb.from('sales').select('*').eq('id', id).single()), ok(sb.from('sale_items').select('*').eq('sale_id', id).order('description'))]);
  app.innerHTML = `${barraVoltar('Venda nº ' + esc(v.number) + ' ' + statusSelo(v.status), '#/vendas')}
  <div class="acoes topo"><button class="btn azul" id="pdf">PDF da venda</button><button class="btn" id="obsBtn" title="Informação adicional que sai no PDF">📝 Informação adicional</button>${v.status === 'confirmada' ? '<button class="btn perigo" id="devolver">Registrar devolução</button>' : ''}</div>
  <div class="card">${v.client_code ? `<span class="selo">cliente ${v.client_code}</span> ` : ""}<b>${esc(v.client_name)}</b> ${v.client_doc ? '· ' + esc(v.client_doc) : ''}<br>${esc(v.client_phone || '')} ${esc(v.client_email || '')}<br><small style="color:var(--muted)">${dataBR(v.date)} ${esc(v.time)} · por ${esc(v.employee_name || '')} · orçamento nº <a href="#/orcamento/${v.quote_id}">${esc(v.quote_number)}</a></small>
  ${v.status === 'devolvida' ? `<p style="color:#9a6700">Devolvida em ${dataBR(v.returned_date)} por ${esc(v.returned_by_name || '')}${v.return_reason ? `<br>Motivo: <b>${esc(v.return_reason)}</b>` : ''}</p>` : ''}</div>
  ${v.observations ? `<div class="card obs-doc"><b>📝 Informação adicional</b> <small>(sai no PDF)</small><p>${esc(v.observations)}</p></div>` : ''}
  ${v.status === 'confirmada' ? `<div class="card"><b>Pagamento</b> ${seloPagamento(v)}<br>
    ${esc(v.payment_method || 'forma não informada')} · vencimento ${dataBR(v.due_date) || '—'}${v.payment_status === 'recebido' ? ` · recebido em ${dataBR(v.received_at)}${v.received_by ? ' por ' + esc(v.received_by) : ''}` : ''}
    <div class="acoes">${v.payment_status === 'aberto' ? '<button class="btn pri" id="receber">Marcar como recebido</button><button class="btn" id="vencimento">Mudar vencimento</button>' : '<button class="btn" id="reabrir">Voltar para "a receber"</button>'}</div></div>` : ''}
  ${tabelaItens(itens, v.discount_percent)}`;
  $('#pdf').onclick = () => pdfDocumento('PEDIDO DE VENDA', v, itens).catch(falhou);
  const atualizar = async (dados, msg) => { try { await ok(sb.from('sales').update(dados).eq('id', id)); aviso(msg); telaVenda(id); } catch (e) { falhou(e); } };
  if ($('#receber')) $('#receber').onclick = async () => {
    const r = await dialogo(`<h2 style="margin-top:0">Receber venda nº ${esc(v.number)}</h2><p>${esc(v.client_name)} · <b>${brl(v.total)}</b></p>
      <label>Forma de pagamento</label><select id="dForma">${FORMAS.map((f) => `<option ${f === v.payment_method ? 'selected' : ''}>${f}</option>`).join('')}</select>
      <label>Data do recebimento</label><input type="date" id="dData" value="${hoje()}">`, 'Confirmar recebimento', () => ({ forma: $('#dForma').value, data: $('#dData').value }));
    if (r) atualizar({ payment_status: 'recebido', payment_method: r.forma, received_at: r.data || hoje(), received_by: S.perfil.full_name }, 'Recebimento registrado.');
  };
  if ($('#vencimento')) $('#vencimento').onclick = async () => {
    const r = await dialogo(`<h2 style="margin-top:0">Novo vencimento</h2><input type="date" id="dVenc" value="${String(v.due_date || hoje()).slice(0, 10)}">`, 'Salvar', () => $('#dVenc').value);
    if (r) atualizar({ due_date: r }, 'Vencimento alterado.');
  };
  $('#obsBtn').onclick = async () => { const r = await editarObs(v.observations, 'venda'); if (r !== null) atualizar({ observations: r || null }, 'Informação salva.'); };
  if ($('#reabrir')) $('#reabrir').onclick = () => { if (confirm('Voltar a venda nº ' + v.number + ' para "a receber"?')) atualizar({ payment_status: 'aberto', received_at: null, received_by: null }, 'Venda voltou para "a receber".'); };
  // Devolução: o motivo é obrigatório (aparece na venda e em Financeiro › Devoluções).
  if ($('#devolver')) $('#devolver').onclick = async () => {
    const motivo = await dialogo(`<h2 style="margin-top:0">Devolução da venda nº ${esc(v.number)}</h2><p>${esc(v.client_name)} · <b>${brl(v.total)}</b><br><small style="color:var(--muted)">O estoque volta e a venda sai do financeiro.</small></p>
      <label>Motivo da devolução *</label><textarea id="dMotivo" rows="3" placeholder="Ex.: produto com defeito, item trocado, cliente desistiu…"></textarea>`, 'Registrar devolução',
      () => { const m = $('#dMotivo').value.trim(); if (m.length < 5) { $('#dMotivo').classList.add('falta'); aviso('Explique o motivo da devolução.', true); return undefined; } return m; },
      () => setTimeout(() => $('#dMotivo').focus(), 30));
    if (!motivo) return;
    try { await ok(sb.rpc('devolver_venda', { p_sale: id, p_motivo: motivo })); aviso('Devolução registrada.'); telaVenda(id); } catch (e) { falhou(e); }
  };
}
// Janela para escrever a informação adicional do orçamento/venda (sai no PDF). Devolve o texto, ou null se cancelar.
function editarObs(atual, doc) {
  return dialogo(`<h2 style="margin-top:0">📝 Informação adicional</h2><p style="color:var(--muted);margin-top:0">Sai no PDF do ${doc}, no quadro "Observações".</p><textarea id="dObs" rows="5" placeholder="Ex.: entrega na sexta, pagamento em 2x, falar com Maria…">${esc(atual || '')}</textarea>`,
    'Salvar', () => $('#dObs').value.trim(), () => setTimeout(() => $('#dObs').focus(), 30));
}

// ---------- financeiro: quitadas e devoluções ----------
// Quitadas: vendas já recebidas e (para o administrador) despesas já pagas, pela data da quitação.
async function telaQuitadas() {
  const adm = ehAdmin();
  app.innerHTML = `${abasFinanceiro('quitadas')}
  <div class="linha"><div style="flex:0 1 200px"><label>Mês da quitação</label><input id="mes" type="month" value="${hoje().slice(0, 7)}" title="Vazio = todos os meses"></div>
    ${adm ? '<div style="flex:0 1 230px"><label>Mostrar</label><select id="tipo"><option value="">Recebidas e pagas</option><option value="r">Só recebidas (vendas)</option><option value="p">Só pagas (despesas)</option></select></div>' : ''}
    <div><label>Buscar</label><input id="busca" placeholder="Cliente, fornecedor, descrição ou nº"></div></div>
  <p style="color:var(--muted);margin:6px 0 0;font-size:13px">Mês vazio = todos os meses. Clique numa linha para abrir.</p>
  <div class="acoes"><button class="btn azul" id="relatorio">📄 Gerar relatório (PDF)</button></div>
  <div id="kpis" class="grade" style="margin-top:12px"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Quitada em</th><th>Tipo</th><th>Documento</th><th>Cliente / fornecedor</th><th class="esconde-cel">Forma</th><th class="num">Valor</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  let linhas = [];
  const soma = (tp) => linhas.filter((l) => l.tipo === tp).reduce((s, l) => s + l.valor, 0);
  const carregar = async () => {
    const m = $('#mes').value, tipo = adm ? $('#tipo').value : 'r', t = limpaBusca($('#busca').value);
    const [a, b] = m ? mesRange(m) : [null, null]; const tarefas = [];
    if (tipo !== 'p') {
      let q = sb.from('sales').select('id,number,client_name,client_code,total,payment_method,received_at').eq('status', 'confirmada').eq('payment_status', 'recebido').order('received_at', { ascending: false }).limit(2000);
      if (a) q = q.gte('received_at', a).lte('received_at', b); if (t) q = q.or(`client_name.ilike.%${t}%,number.ilike.%${t}%`);
      tarefas.push(ok(q).then((l) => l.map((v) => ({ tipo: 'r', id: v.id, data: v.received_at, doc: 'Venda nº ' + v.number, quem: (v.client_code ? v.client_code + ' · ' : '') + v.client_name, forma: v.payment_method || '', valor: Number(v.total) }))));
    }
    if (adm && tipo !== 'r') {
      let q = sb.from('expenses').select('id,description,supplier,category,amount,paid_at').eq('status', 'pago').order('paid_at', { ascending: false }).limit(2000);
      if (a) q = q.gte('paid_at', a).lte('paid_at', b); if (t) q = q.or(`description.ilike.%${t}%,supplier.ilike.%${t}%`);
      tarefas.push(ok(q).then((l) => l.map((d) => ({ tipo: 'p', id: d.id, data: d.paid_at, doc: d.description, quem: d.supplier || d.category || '', forma: '', valor: Number(d.amount) }))));
    }
    linhas = (await Promise.all(tarefas)).flat().sort((x, y) => String(y.data).localeCompare(String(x.data)));
    $('#kpis').innerHTML = `<div class="kpi"><small>Recebido</small><strong style="color:var(--green-d)">${brl(soma('r'))}</strong></div>${adm ? `<div class="kpi"><small>Pago</small><strong style="color:var(--red)">${brl(soma('p'))}</strong></div><div class="kpi"><small>Saldo (recebido − pago)</small><strong>${brl(soma('r') - soma('p'))}</strong></div>` : ''}<div class="kpi"><small>Lançamentos</small><strong>${linhas.length}</strong></div>`;
    $('#lista').innerHTML = linhas.map((l, k) => `<tr class="clica" data-k="${k}"><td>${dataBR(l.data)}</td><td>${l.tipo === 'r' ? '<span class="selo recebido">recebida</span>' : '<span class="selo saida">paga</span>'}</td><td>${esc(l.doc)}</td><td>${esc(l.quem)}</td><td class="esconde-cel">${esc(l.forma)}</td><td class="num"><b style="color:${l.tipo === 'r' ? 'var(--green-d)' : 'var(--red)'}">${l.tipo === 'p' ? '− ' : ''}${brl(l.valor)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nada quitado neste filtro.</td></tr>';
    $$('#lista tr[data-k]').forEach((tr) => (tr.onclick = () => { const l = linhas[tr.dataset.k]; location.hash = l.tipo === 'r' ? '#/venda/' + l.id : '#/financeiro/despesas'; }));
  };
  let tt; $('#busca').oninput = () => { clearTimeout(tt); tt = setTimeout(carregar, 300); }; $('#mes').onchange = carregar; if ($('#tipo')) $('#tipo').onchange = carregar;
  $('#relatorio').onclick = () => pdfTabela('CONTAS QUITADAS', [$('#mes').value ? 'Mês: ' + $('#mes').value.split('-').reverse().join('/') : 'Todos os meses', $('#busca').value.trim() && 'Filtro: ' + $('#busca').value.trim()].filter(Boolean).join(' • '),
    adm ? [['Recebido', brl(soma('r'))], ['Pago', brl(soma('p'))], ['Saldo', brl(soma('r') - soma('p'))]] : [['Recebido', brl(soma('r'))], ['Lançamentos', String(linhas.length)]],
    ['Quitada em', 'Tipo', 'Documento', 'Cliente / fornecedor', 'Forma', 'Valor'], linhas.map((l) => [dataBR(l.data), l.tipo === 'r' ? 'Recebida' : 'Paga', l.doc, l.quem, l.forma, (l.tipo === 'p' ? '- ' : '') + brl(l.valor)]),
    { 0: { cellWidth: 20 }, 1: { cellWidth: 18 }, 4: { cellWidth: 26 }, 5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' } }, 'Quitadas').catch(falhou);
  carregar();
}
// Devoluções: vendas devolvidas, com o motivo informado por quem registrou.
async function telaDevolucoes(origem) {
  const topo = origem === 'vendas' ? secao('vendas', '#/vendas/devolvidas') : abasFinanceiro('devolucoes');
  app.innerHTML = `${topo}<div class="linha"><div style="flex:0 1 200px"><label>Mês da devolução</label><input id="mes" type="month" value="" title="Vazio = todos os meses"></div><div><label>Buscar</label><input id="busca" placeholder="Cliente, nº da venda ou motivo"></div></div>
  <div class="acoes"><button class="btn azul" id="relatorio">📄 Gerar relatório (PDF)</button></div><div id="kpis" class="grade" style="margin-top:12px"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Devolvida em</th><th>Venda</th><th>Cliente</th><th class="num">Valor</th><th>Motivo</th><th class="esconde-cel">Registrada por</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  let vs = [];
  const soma = () => vs.reduce((s, v) => s + Number(v.total), 0);
  const carregar = async () => {
    let q = sb.from('sales').select('id,number,client_name,client_code,total,date,returned_date,returned_by_name,return_reason').eq('status', 'devolvida').order('returned_date', { ascending: false }).limit(1000);
    const m = $('#mes').value; if (m) { const [a, b] = mesRange(m); q = q.gte('returned_date', a).lte('returned_date', b); }
    const t = limpaBusca($('#busca').value); if (t) q = q.or(`client_name.ilike.%${t}%,number.ilike.%${t}%,return_reason.ilike.%${t}%`);
    vs = await ok(q);
    $('#kpis').innerHTML = `<div class="kpi"><small>Devoluções</small><strong>${vs.length}</strong></div><div class="kpi"><small>Valor devolvido</small><strong style="color:var(--red)">${brl(soma())}</strong></div>`;
    $('#lista').innerHTML = vs.map((v) => `<tr class="clica" onclick="location.hash='#/venda/${v.id}'"><td>${dataBR(v.returned_date)}</td><td>${esc(v.number)}<br><small style="color:var(--muted)">de ${dataBR(v.date)}</small></td><td>${v.client_code ? `<small style="color:var(--muted)">${v.client_code}</small> ` : ''}${esc(v.client_name)}</td><td class="num">${brl(v.total)}</td><td>${v.return_reason ? esc(v.return_reason) : '<small style="color:var(--muted)">não informado</small>'}</td><td class="esconde-cel">${esc(v.returned_by_name || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma devolução.</td></tr>';
  };
  let tt; $('#busca').oninput = () => { clearTimeout(tt); tt = setTimeout(carregar, 300); }; $('#mes').onchange = carregar;
  $('#relatorio').onclick = () => pdfTabela('DEVOLUÇÕES', $('#mes').value ? 'Mês: ' + $('#mes').value.split('-').reverse().join('/') : 'Todos os meses', [['Devoluções', String(vs.length)], ['Valor devolvido', brl(soma())]],
    ['Devolvida em', 'Venda', 'Cliente', 'Valor', 'Motivo', 'Por'], vs.map((v) => [dataBR(v.returned_date), v.number, v.client_name, brl(v.total), v.return_reason || 'não informado', v.returned_by_name || '']),
    { 0: { cellWidth: 20 }, 1: { cellWidth: 14 }, 3: { cellWidth: 22, halign: 'right' }, 5: { cellWidth: 24 } }, 'Devolucoes').catch(falhou);
  carregar();
}

// ---------- financeiro ----------
const abasFinanceiro = (atual) => secao('financeiro', '#/financeiro/' + atual);
async function telaFinanceiro() {
  const mesAtual = hoje().slice(0, 7);
  app.innerHTML = `${abasFinanceiro('resumo')}<div class="linha"><input id="mes" type="month" value="${mesAtual}" style="flex:0 1 200px"></div><div id="fin"></div>`;
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
    // Despesas do mês (só administrador): pagas no mês, a pagar com vencimento no mês e resultado.
    let blocoDesp = '';
    if (ehAdmin()) {
      const [a, b] = mesRange(m);
      const ds = await ok(sb.from('expenses').select('amount,status,due_date,paid_at').or(`and(due_date.gte.${a},due_date.lte.${b}),and(paid_at.gte.${a},paid_at.lte.${b})`).limit(5000));
      const pagasMes = ds.filter((d) => d.status === 'pago' && d.paid_at >= a && d.paid_at <= b).reduce((s, d) => s + Number(d.amount), 0);
      const aPagar = ds.filter((d) => d.status === 'aberto' && d.due_date >= a && d.due_date <= b).reduce((s, d) => s + Number(d.amount), 0);
      const res = fat - pagasMes;
      blocoDesp = `<div class="grade" style="margin-top:12px">
        <div class="kpi"><small>Despesas pagas no mês</small><strong style="color:var(--red)">${brl(pagasMes)}</strong></div>
        <div class="kpi"><small>Despesas a pagar no mês</small><strong>${brl(aPagar)}</strong></div>
        <a class="kpi" href="#/financeiro/despesas" style="text-decoration:none;color:inherit;grid-column:span 2"><small>Resultado do mês (faturamento − despesas pagas)</small><strong style="color:${res >= 0 ? 'var(--green-d)' : 'var(--red)'}">${brl(res)}</strong></a></div>`;
    }
    $('#fin').innerHTML = `<div class="grade" style="margin-top:12px">
      <div class="kpi"><small>Faturamento</small><strong>${brl(fat)}</strong></div><div class="kpi"><small>Vendas</small><strong>${doMes.length}</strong></div>
      <div class="kpi"><small>Ticket médio</small><strong>${brl(doMes.length ? fat / doMes.length : 0)}</strong></div><div class="kpi"><small>Descontos dados</small><strong>${brl(desc)}</strong></div></div>${blocoDesp}
      <div class="card" style="margin-top:12px"><b>Meta do mês:</b> ${metaV ? brl(metaV) + ' · ' + pctMeta.toFixed(0) + '% atingido' : 'não definida (Admin › Empresa)'}<div class="meta" style="margin-top:8px"><i style="width:${pctMeta}%"></i></div></div>
      <div class="card"><b>Últimos 6 meses</b><div class="barras">${meses.map((x) => `<div><small>${x.v ? brl(x.v).replace(',00', '') : ''}</small><i style="height:${(x.v / maior) * 130}px"></i>${x.rot}</div>`).join('')}</div></div>
      <h2>Desempenho por vendedor</h2><div class="tabela"><table><thead><tr><th>Vendedor</th><th class="num">Vendas</th><th class="num">Total</th></tr></thead><tbody>
      ${Object.entries(porFunc).sort((a, b) => b[1].t - a[1].t).map(([k, x]) => `<tr><td>${esc(k)}</td><td class="num">${x.n}</td><td class="num">${brl(x.t)}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Sem vendas no mês.</td></tr>'}</tbody></table></div>`;
  };
  $('#mes').onchange = carregar; carregar();
}

// Contas a receber: vendas confirmadas ainda não pagas, por vencimento, com relatório em PDF.
async function telaAReceber() {
  app.innerHTML = `${abasFinanceiro('receber')}
  <div class="linha"><input id="busca" placeholder="Filtrar por cliente, código ou nº da venda"><select id="sit" style="flex:0 1 200px"><option value="">Todas em aberto</option><option value="vencidas">Só vencidas</option><option value="avencer">Só a vencer</option></select></div>
  <div class="acoes"><button class="btn azul" id="relatorio">📄 Gerar relatório (PDF)</button></div>
  <div id="kpis" class="grade" style="margin-top:12px"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Venda</th><th>Cliente</th><th class="esconde-cel">Emissão</th><th>Vencimento</th><th class="esconde-cel">Forma</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  let atual = [];
  const carregar = async () => {
    let qy = sb.from('sales').select('*').eq('status', 'confirmada').eq('payment_status', 'aberto').order('due_date').order('number').limit(2000);
    const t = limpaBusca($('#busca').value); if (t) qy = qy.or(`client_name.ilike.%${t}%,number.ilike.%${t}%` + (/^[0-9]{1,4}$/.test(t) ? `,client_code.eq.${t}` : ''));
    let vs = await ok(qy);
    if ($('#sit').value === 'vencidas') vs = vs.filter((v) => diasAtraso(v.due_date) > 0);
    if ($('#sit').value === 'avencer') vs = vs.filter((v) => diasAtraso(v.due_date) <= 0);
    atual = vs;
    const soma = (l) => l.reduce((s, v) => s + Number(v.total), 0);
    const venc = vs.filter((v) => diasAtraso(v.due_date) > 0);
    const clientes = new Set(vs.map((v) => v.client_code || v.client_name)).size;
    $('#kpis').innerHTML = `<div class="kpi"><small>Total em aberto</small><strong>${brl(soma(vs))}</strong></div>
      <div class="kpi"><small>Vencido</small><strong style="color:var(--red)">${brl(soma(venc))}</strong></div>
      <div class="kpi"><small>A vencer</small><strong>${brl(soma(vs) - soma(venc))}</strong></div>
      <div class="kpi"><small>Vendas / clientes</small><strong>${vs.length} / ${clientes}</strong></div>`;
    $('#lista').innerHTML = vs.map((v) => `<tr class="clica" onclick="location.hash='#/venda/${v.id}'"><td>${esc(v.number)}</td><td>${v.client_code ? `<small style="color:var(--muted)">${v.client_code}</small> ` : ''}${esc(v.client_name)}</td><td class="esconde-cel">${dataBR(v.date)}</td><td>${dataBR(v.due_date)}</td><td class="esconde-cel">${esc(v.payment_method || '')}</td><td class="num"><b>${brl(v.total)}</b></td><td>${seloPagamento(v)}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nada em aberto. 🎉</td></tr>';
  };
  let tt; $('#busca').oninput = () => { clearTimeout(tt); tt = setTimeout(carregar, 300); }; $('#sit').onchange = carregar;
  $('#relatorio').onclick = () => pdfReceber(atual, [$('#busca').value.trim() && 'Filtro: ' + $('#busca').value.trim(), $('#sit').selectedOptions[0].text].filter(Boolean).join(' • ')).catch(falhou);
  carregar();
}

// ---------- despesas (contas a pagar) — só administrador ----------
const CATEGORIAS = ['Compra de mercadoria', 'Aluguel', 'Energia', 'Água', 'Internet e telefone', 'Combustível e frete', 'Salários e comissões', 'Impostos (DAS/MEI)', 'Marketing', 'Manutenção', 'Embalagens e material', 'Taxas bancárias e cartão', 'Outros'];
const seloDespesa = (d) => d.status === 'pago' ? '<span class="selo recebido">paga</span>' : diasAtraso(d.due_date) > 0 ? `<span class="selo vencido">${textoPrazo(d.due_date).toLowerCase()}</span>` : `<span class="selo aberto">a pagar · ${textoPrazo(d.due_date).toLowerCase()}</span>`;
const mesRange = (m) => { const [y, mm] = m.split('-').map(Number); return [m + '-01', m + '-' + String(new Date(y, mm, 0).getDate()).padStart(2, '0')]; };
async function telaDespesas(modo) {
  if (!ehAdmin()) { app.innerHTML = '<p class="vazio">Despesas: acesso restrito ao administrador.</p>'; return; }
  const topo = secao('financeiro', modo === 'nova' ? '#/financeiro/despesas/nova' : '#/financeiro/despesas');
  if (modo === 'nova') { app.innerHTML = `${topo}<div id="form"></div>`; formDespesa(null, () => (location.hash = '#/financeiro/despesas'), () => (location.hash = '#/financeiro')); return; }
  app.innerHTML = `${topo}
  <div class="linha"><div style="flex:0 1 210px"><label>Mês de vencimento</label><input id="mes" type="month" value="" title="Deixe vazio para ver todos os meses"></div>
    <div style="flex:0 1 210px"><label>Situação</label><select id="sit"><option value="aberto" selected>Em aberto (a pagar)</option><option value="vencidas">Vencidas</option><option value="pago">Pagas</option><option value="">Todas</option></select></div>
    <div><label>Buscar</label><input id="busca" placeholder="Descrição ou fornecedor"></div></div>
  <p style="color:var(--muted);margin:6px 0 0;font-size:13px">Mês vazio = todos os meses. Clique numa despesa para editar, marcar como paga ou excluir.</p>
  <div class="acoes"><a class="btn pri" href="#/financeiro/despesas/nova">＋ Nova despesa</a><button class="btn azul" id="relatorio">📄 Gerar relatório (PDF)</button></div>
  <div id="form"></div><div id="kpis" class="grade" style="margin-top:12px"></div><div id="cats"></div>
  <div class="tabela" style="margin-top:12px"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th class="esconde-cel">Categoria</th><th class="esconde-cel">Fornecedor</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody id="lista"></tbody></table></div>`;
  let atual = [];
  const carregar = async () => {
    const m = $('#mes').value; let q = sb.from('expenses').select('*').order('due_date').order('description').limit(2000);
    if (m) { const [a, b] = mesRange(m); q = q.gte('due_date', a).lte('due_date', b); }
    const t = limpaBusca($('#busca').value); if (t) q = q.or(`description.ilike.%${t}%,supplier.ilike.%${t}%,category.ilike.%${t}%`);
    let ds = await ok(q);
    const sit = $('#sit').value;
    if (sit === 'aberto') ds = ds.filter((d) => d.status === 'aberto'); if (sit === 'pago') ds = ds.filter((d) => d.status === 'pago');
    if (sit === 'vencidas') ds = ds.filter((d) => d.status === 'aberto' && diasAtraso(d.due_date) > 0);
    atual = ds;
    const soma = (l) => l.reduce((s, d) => s + Number(d.amount), 0);
    const pagas = ds.filter((d) => d.status === 'pago'), abertas = ds.filter((d) => d.status === 'aberto'), venc = abertas.filter((d) => diasAtraso(d.due_date) > 0);
    $('#kpis').innerHTML = `<div class="kpi"><small>Total de despesas</small><strong>${brl(soma(ds))}</strong></div><div class="kpi"><small>Pagas</small><strong>${brl(soma(pagas))}</strong></div>
      <div class="kpi"><small>A pagar</small><strong>${brl(soma(abertas))}</strong></div><div class="kpi"><small>Vencidas</small><strong style="color:var(--red)">${brl(soma(venc))}</strong></div>`;
    const porCat = {}; ds.forEach((d) => (porCat[d.category] = (porCat[d.category] || 0) + Number(d.amount)));
    $('#cats').innerHTML = Object.keys(porCat).length ? `<div class="card" style="margin-top:12px"><b>Por categoria</b><div style="margin-top:8px">${Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid var(--line)"><span>${esc(c)}</span><b>${brl(v)}</b></div>`).join('')}</div></div>` : '';
    $('#lista').innerHTML = ds.map((d) => `<tr class="clica" data-id="${d.id}"><td>${dataBR(d.due_date)}${d.original_due_date && d.original_due_date !== d.due_date ? `<br><small style="color:var(--muted)">dia útil (era ${dataBR(d.original_due_date)})</small>` : ''}</td><td>${esc(d.description)}</td><td class="esconde-cel">${esc(d.category)}</td><td class="esconde-cel">${esc(d.supplier || '')}</td><td class="num"><b>${brl(d.amount)}</b></td><td>${seloDespesa(d)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma despesa neste filtro.</td></tr>';
    $$('#lista tr[data-id]').forEach((tr) => (tr.onclick = () => formDespesa(ds.find((d) => d.id === tr.dataset.id), carregar)));
  };
  let tt; $('#busca').oninput = () => { clearTimeout(tt); tt = setTimeout(carregar, 300); }; $('#mes').onchange = carregar; $('#sit').onchange = carregar;
  $('#relatorio').onclick = () => pdfDespesas(atual, [$('#mes').value && 'Mês: ' + $('#mes').value.split('-').reverse().join('/'), $('#sit').selectedOptions[0].text, $('#busca').value.trim() && 'Filtro: ' + $('#busca').value.trim()].filter(Boolean).join(' • ')).catch(falhou);
  carregar();
}
// ---------- dias úteis ----------
// Feriados nacionais (fixos e móveis, incluindo Carnaval e Corpus Christi, quando os bancos não abrem) + 2 de Julho (Bahia).
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const _feriados = {};
function feriadosDoAno(ano) {
  if (_feriados[ano]) return _feriados[ano];
  const iso = (dt) => dt.toLocaleDateString('sv-SE'); const p = pascoa(ano); const mais = (n) => new Date(p.getFullYear(), p.getMonth(), p.getDate() + n);
  const lista = { [`${ano}-01-01`]: 'Confraternização Universal', [`${ano}-04-21`]: 'Tiradentes', [`${ano}-05-01`]: 'Dia do Trabalho', [`${ano}-07-02`]: 'Independência da Bahia', [`${ano}-09-07`]: 'Independência do Brasil',
    [`${ano}-10-12`]: 'Nossa Senhora Aparecida', [`${ano}-11-02`]: 'Finados', [`${ano}-11-15`]: 'Proclamação da República', [`${ano}-11-20`]: 'Consciência Negra', [`${ano}-12-25`]: 'Natal',
    [iso(mais(-48))]: 'Carnaval', [iso(mais(-47))]: 'Carnaval', [iso(mais(-2))]: 'Sexta-feira Santa', [iso(mais(60))]: 'Corpus Christi' };
  return (_feriados[ano] = lista);
}
// Se a data cair em sábado, domingo ou feriado, devolve o próximo dia útil (e o motivo).
function proximoDiaUtil(iso) {
  let dt = new Date(iso + 'T12:00:00'); const motivos = [];
  for (let n = 0; n < 15; n++) {
    const s = dt.toLocaleDateString('sv-SE'), fer = feriadosDoAno(dt.getFullYear())[s], dow = dt.getDay();
    if (dow !== 0 && dow !== 6 && !fer) return { data: s, motivo: motivos[0] || '' };
    motivos.push(fer || (dow === 6 ? 'sábado' : 'domingo')); dt.setDate(dt.getDate() + 1);
  }
  return { data: iso, motivo: '' };
}
// Datas de vencimento de uma despesa repetida: mesmo dia em cada mês (ou o último dia, se o mês for mais curto).
function datasRepetidas(iso, n) {
  const [y, m, dia] = iso.split('-').map(Number);
  return [...Array(Math.max(1, n))].map((_, k) => { const ult = new Date(y, m - 1 + k + 1, 0).getDate(); return new Date(y, m - 1 + k, Math.min(dia, ult)).toLocaleDateString('sv-SE'); });
}
function formDespesa(d, depois, aoCancelar) {
  d = d || {};
  $('#form').innerHTML = `<div class="card"><h2 style="margin-top:0">${d.id ? 'Editar despesa' : 'Nova despesa'}</h2><form id="fd">
    <div class="linha"><div style="flex:2 1 260px"><label>Descrição</label><input name="description" required value="${esc(d.description)}" placeholder="Ex.: Aluguel do depósito, Compra Candeias NF 1234"></div>
    <div><label>Categoria</label><select name="category">${CATEGORIAS.map((c) => `<option ${c === (d.category || 'Outros') ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
    <div class="linha"><div><label>Fornecedor / a quem pagar</label><input name="supplier" value="${esc(d.supplier)}"></div><div><label>Valor (R$)</label><input name="amount" required inputmode="decimal" value="${d.amount != null ? String(d.amount).replace('.', ',') : ''}"></div><div><label>Data de vencimento</label><input type="date" name="due_date" required value="${String(d.original_due_date || d.due_date || hoje()).slice(0, 10)}"></div></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--ink)"><input type="checkbox" id="diaUtil" style="width:auto" ${d.business_day ? 'checked' : ''}> Pagamento somente em dia útil (se cair em sábado, domingo ou feriado, passa para o próximo dia útil)</label>
    <p class="dica" id="infoDiaUtil" hidden></p>
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--ink)"><input type="checkbox" id="pago" style="width:auto" ${d.status === 'pago' ? 'checked' : ''}> Já está paga</label>
    <div class="linha" id="boxPago"><div><label>Data do pagamento</label><input type="date" name="paid_at" value="${String(d.paid_at || hoje()).slice(0, 10)}"></div><div><label>Forma de pagamento</label><select name="payment_method">${FORMAS.map((f) => `<option ${f === d.payment_method ? 'selected' : ''}>${f}</option>`).join('')}</select></div></div>
    ${d.id ? '' : '<div class="linha"><div style="flex:0 1 260px"><label>Repetir nos próximos meses (ex.: aluguel)</label><select name="repetir"><option value="1">Não repetir</option>' + [2, 3, 6, 12].map((n) => `<option value="${n}">${n} meses (inclui este)</option>`).join('') + '</select></div></div>'}
    <label>Observações</label><textarea name="notes">${esc(d.notes)}</textarea>
    <div class="acoes"><button class="btn pri">Salvar</button><button type="button" class="btn" id="cancela">Cancelar</button>${d.id ? '<button type="button" class="btn perigo" id="apaga">Excluir</button><button type="button" class="btn perigo" id="apagaProx" hidden></button>' : ''}</div></form></div>`;
  $('#form').scrollIntoView({ behavior: 'smooth' });
  // Despesa repetida (lançada junto com outras, ex.: DAS 12 meses): permite excluir esta e as próximas de uma vez.
  if (d.id && d.created_at) {
    sb.from('expenses').select('id,due_date').eq('created_at', d.created_at).eq('description', d.description).eq('status', 'aberto').gte('due_date', String(d.due_date).slice(0, 10)).then(({ data }) => {
      if (!data || data.length < 2 || !$('#apagaProx')) return;
      const b = $('#apagaProx'); b.hidden = false; b.textContent = `Excluir esta e as próximas (${data.length})`;
      b.onclick = async () => {
        if (!confirm(`Excluir ${data.length} despesas "${d.description}" (de ${dataBR(d.due_date)} em diante, só as não pagas)?`)) return;
        try { await ok(sb.from('expenses').delete().in('id', data.map((x) => x.id))); aviso(`${data.length} despesas excluídas.`); $('#form').innerHTML = ''; depois(); } catch (e) { falhou(e); }
      };
    });
  }
  const sinc = () => ($('#boxPago').hidden = !$('#pago').checked); $('#pago').onchange = sinc; sinc();
  // Mostra na hora em que dia o pagamento vai ficar (e, nas repetidas, o ajuste de cada mês).
  const infoUtil = () => {
    const box = $('#infoDiaUtil'), venc = $('#fd').due_date.value, rep = Number($('#fd').repetir?.value || 1);
    if (!$('#diaUtil').checked || !venc) { box.hidden = true; return; }
    const datas = datasRepetidas(venc, rep).map((x) => ({ x, u: proximoDiaUtil(x) }));
    const ajustadas = datas.filter((v) => v.u.data !== v.x);
    box.hidden = false;
    box.innerHTML = ajustadas.length ? `Ajustes para dia útil: ${ajustadas.slice(0, 6).map((v) => `${dataBR(v.x)} (${v.u.motivo}) → <b>${dataBR(v.u.data)}</b>`).join('; ')}${ajustadas.length > 6 ? ` e mais ${ajustadas.length - 6}` : ''}.` : `${dataBR(venc)} já é dia útil${rep > 1 ? ' (e os outros meses também)' : ''}.`;
  };
  $('#diaUtil').onchange = infoUtil; $('#fd').due_date.addEventListener('change', infoUtil); if ($('#fd').repetir) $('#fd').repetir.addEventListener('change', infoUtil); infoUtil();
  $('#cancela').onclick = () => (aoCancelar ? aoCancelar() : ($('#form').innerHTML = ''));
  if ($('#apaga')) $('#apaga').onclick = async () => { if (!confirm('Excluir a despesa "' + d.description + '"?')) return; try { await ok(sb.from('expenses').delete().eq('id', d.id)); aviso('Despesa excluída.'); $('#form').innerHTML = ''; depois(); } catch (e) { falhou(e); } };
  $('#fd').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const pago = $('#pago').checked; const rep = Number(f.repetir || 1); delete f.repetir;
    const util = $('#diaUtil').checked;
    const ajusta = (iso) => ({ original_due_date: iso, due_date: util ? proximoDiaUtil(iso).data : iso });
    const reg = { description: f.description.trim(), category: f.category, supplier: f.supplier.trim() || null, amount: num(f.amount), ...ajusta(f.due_date), business_day: util, notes: f.notes.trim() || null,
      status: pago ? 'pago' : 'aberto', paid_at: pago ? f.paid_at || hoje() : null, payment_method: pago ? f.payment_method : null };
    if (!reg.amount) return aviso('Informe o valor.', true);
    try {
      if (d.id) await ok(sb.from('expenses').update(reg).eq('id', d.id));
      else {
        const regs = datasRepetidas(f.due_date, rep).map((iso, k) => k === 0 ? { ...reg, created_by: S.perfil.full_name } : { ...reg, ...ajusta(iso), status: 'aberto', paid_at: null, payment_method: null, created_by: S.perfil.full_name });
        await ok(sb.from('expenses').insert(regs));
      }
      aviso(rep > 1 ? `Despesa lançada para ${rep} meses.` : 'Despesa salva.'); $('#form').innerHTML = ''; depois();
    } catch (err) { falhou(err); }
  };
}
async function pdfDespesas(lista, filtro) {
  const c = S.empresa || {};
  const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await carregarLogo();
  const M = 12, L = 186, NAVY = [3, 35, 68], TINTA = [13, 42, 74], CINZA = [96, 114, 138], LINHA = [223, 231, 240], FUNDO = [244, 247, 251], VERMELHO = [200, 55, 55];
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' }).slice(0, 17).replace(',', ' às');
  cabecalhoPdf(pdf, c, logo, 'RELATÓRIO DE DESPESAS', 'Contas a pagar', 'Gerado em ' + agora);
  const soma = (l) => l.reduce((s, d) => s + Number(d.amount), 0);
  const pagas = lista.filter((d) => d.status === 'pago'), abertas = lista.filter((d) => d.status === 'aberto'), venc = abertas.filter((d) => diasAtraso(d.due_date) > 0);
  let y = 48; const w = (L - 9) / 4;
  [['Total de despesas', brl(soma(lista)), TINTA], ['Pagas', brl(soma(pagas)), TINTA], ['A pagar', brl(soma(abertas)), TINTA], ['Vencidas', brl(soma(venc)), VERMELHO]].forEach(([r, v, cor], k) => {
    const x = M + k * (w + 3); pdf.setFillColor(...FUNDO); pdf.setDrawColor(...LINHA); pdf.roundedRect(x, y, w, 17, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(...CINZA); pdf.text(r.toUpperCase(), x + 4, y + 6); pdf.setFontSize(12); pdf.setTextColor(...cor); pdf.text(v, x + 4, y + 13);
  });
  y += 22;
  if (filtro) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...CINZA); pdf.text(filtro, M, y); y += 4; }
  const situacao = (d) => d.status === 'pago' ? 'Paga em ' + dataBR(d.paid_at) : textoPrazo(d.due_date);
  pdf.autoTable({
    startY: y + 1, margin: { left: M, right: M, top: 20, bottom: 22 },
    head: [['Vencimento', 'Descrição', 'Categoria', 'Fornecedor', 'Situação', 'Valor']],
    body: lista.map((d) => [dataBR(d.due_date), d.description, d.category, d.supplier || '', situacao(d), brl(d.amount)]),
    foot: [[{ content: `TOTAL (${lista.length} ${lista.length === 1 ? 'despesa' : 'despesas'})`, colSpan: 5, styles: { halign: 'right' } }, brl(soma(lista))]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 1.8, right: 1.8 }, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 }, valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, lineWidth: 0 },
    footStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 250, 253] },
    columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' }, 2: { cellWidth: 32, textColor: CINZA }, 3: { cellWidth: 32 }, 4: { cellWidth: 30 }, 5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' } },
    didParseCell: (k) => { if (k.section === 'body' && k.column.index === 4) { const t = String(k.cell.raw); k.cell.styles.fontStyle = 'bold'; k.cell.styles.textColor = t.startsWith('Paga') ? [60, 140, 30] : t.startsWith('Vencida') ? VERMELHO : t.startsWith('Vence hoje') ? [190, 120, 0] : TINTA; } if (k.section === 'head' && k.column.index === 5) k.cell.styles.halign = 'right'; },
    didDrawPage: (k) => { if (k.pageNumber > 1) { pdf.setFillColor(...NAVY); pdf.rect(0, 0, 210, 14, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255); pdf.text('HIGIVARO  •  Relatório de despesas  •  ' + agora, M, 9); } },
  });
  // Resumo por categoria
  const porCat = {}; lista.forEach((d) => (porCat[d.category] = (porCat[d.category] || 0) + Number(d.amount)));
  if (Object.keys(porCat).length) {
    pdf.autoTable({ startY: pdf.lastAutoTable.finalY + 8, margin: { left: M, right: 210 - M - 100, bottom: 22 }, head: [['Por categoria', 'Total']], body: Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, brl(v)]),
      theme: 'plain', styles: { fontSize: 8, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 } }, headStyles: { fillColor: [47, 134, 222], textColor: [255, 255, 255], fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } } });
  }
  if (!lista.length) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...CINZA); pdf.text('Nenhuma despesa neste filtro.', 105, y + 25, { align: 'center' }); }
  rodapePdf(pdf, c);
  pdf.save(`Despesas-${hoje()}.pdf`);
}

// ---------- notas fiscais de entrada (compras) — só administrador ----------
// Carrega um script de CDN só quando for usado (pdf.js para PDF, ZXing para código de barras da foto).
const scriptsCarregados = {};
function carregarScript(src) {
  return (scriptsCarregados[src] = scriptsCarregados[src] || new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('não carregou ' + src)); document.head.appendChild(s); }));
}
// A chave de acesso (44 dígitos) já traz: UF, AAMM, CNPJ do emitente, modelo, série e número.
function dadosDaChave(ch) {
  ch = soDig(ch); if (ch.length !== 44) return null;
  return { access_key: ch, supplier_cnpj: formatarDoc(ch.slice(6, 20)), series: String(Number(ch.slice(22, 25))), number: String(Number(ch.slice(25, 34))) };
}
// XML da NF-e (procNFe ou NFe): fornecedor, número, data, itens, total e parcelas.
function lerXmlNfe(texto) {
  const doc = new DOMParser().parseFromString(texto, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('arquivo não é um XML válido');
  const um = (pai, nome) => { const el = (pai || doc).getElementsByTagNameNS('*', nome)[0]; return el ? el.textContent.trim() : ''; };
  const inf = doc.getElementsByTagNameNS('*', 'infNFe')[0];
  if (!inf) throw new Error('este XML não é de NF-e (não achei a tag infNFe)');
  const emit = doc.getElementsByTagNameNS('*', 'emit')[0];
  const itens = [...doc.getElementsByTagNameNS('*', 'det')].map((det) => {
    const prod = det.getElementsByTagNameNS('*', 'prod')[0];
    const ean = um(prod, 'cEAN'); const q = Number(um(prod, 'qCom')) || 0; const vProd = Number(um(prod, 'vProd')) || 0;
    // Lote e validade (grupo <rastro>, pode ter vários lotes por item).
    const rastros = [...det.getElementsByTagNameNS('*', 'rastro')].map((r) => ({ lote: um(r, 'nLote'), val: um(r, 'dVal') }));
    // Frete, IPI e ICMS-ST destacados no item viram % sobre o valor dos produtos.
    const pct = (v) => (vProd ? Math.round((v / vProd) * 10000) / 100 : 0);
    const vFrete = Number(um(prod, 'vFrete')) || 0, vIPI = Number(um(det, 'vIPI')) || 0, vST = Number(um(det, 'vICMSST')) || 0;
    return { supplier_code: um(prod, 'cProd'), ean: /^\d{8,14}$/.test(ean) ? ean : '', description: um(prod, 'xProd'), unit: um(prod, 'uCom'), quantity: q, unit_cost: q ? Math.round((vProd / q) * 10000) / 10000 : 0, vProd,
      lot: rastros.map((r) => r.lote).filter(Boolean).join(', '), expiry: rastros.map((r) => r.val).filter(Boolean).sort()[0] || '',
      xmlFrete: vFrete ? pct(vFrete) : null, xmlImposto: vIPI + vST ? pct(vIPI + vST) : null };
  });
  const parcelas = [...doc.getElementsByTagNameNS('*', 'dup')].map((d) => ({ due_date: um(d, 'dVenc'), amount: Number(um(d, 'vDup')) || 0 })).filter((p) => p.amount);
  const tot = doc.getElementsByTagNameNS('*', 'ICMSTot')[0];
  const dest = doc.getElementsByTagNameNS('*', 'dest')[0];
  const prot = doc.getElementsByTagNameNS('*', 'infProt')[0];
  return {
    nota: { access_key: (inf.getAttribute('Id') || '').replace(/^NFe/, ''), number: um(null, 'nNF'), series: um(null, 'serie'), issue_date: (um(null, 'dhEmi') || um(null, 'dEmi')).slice(0, 10),
      supplier_name: um(emit, 'xNome'), supplier_cnpj: formatarDoc(um(emit, 'CNPJ') || um(emit, 'CPF')), total: Number(um(tot, 'vNF')) || 0, source: 'xml', xml: texto },
    xmlInfo: { modelo: um(null, 'mod'), ambiente: um(null, 'tpAmb'), destCnpj: soDig(um(dest, 'CNPJ') || um(dest, 'CPF')), vProd: Number(um(tot, 'vProd')) || 0,
      protStatus: um(prot, 'cStat'), protNumero: um(prot, 'nProt'), protMotivo: um(prot, 'xMotivo'), assinado: doc.getElementsByTagNameNS('*', 'Signature').length > 0 },
    itens, parcelas,
  };
}
// Dígito verificador da chave de acesso (módulo 11) e do CNPJ.
function chaveValida(ch) {
  ch = soDig(ch); if (ch.length !== 44) return false;
  let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += Number(ch[i]) * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11; return (r < 2 ? 0 : 11 - r) === Number(ch[43]);
}
function cnpjValido(c) {
  c = soDig(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base) => { let s = 0, p = base.length - 7; for (let i = 0; i < base.length; i++) { s += Number(base[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}
// Conferência da nota (tudo o que dá para checar sem o certificado). A consulta oficial na SEFAZ (situação atual, cancelamento) entra na etapa 2.
async function conferirNota(d) {
  const n = d.nota, x = d.xmlInfo || {}, r = [];
  const add = (st, txt) => r.push({ st, txt });
  if (n.access_key) {
    add(chaveValida(n.access_key) ? 'ok' : 'erro', chaveValida(n.access_key) ? 'Chave de acesso válida (dígito verificador confere).' : 'Chave de acesso INVÁLIDA (dígito verificador não confere).');
    const k = dadosDaChave(n.access_key);
    if (k && n.source === 'xml') add(soDig(k.supplier_cnpj) === soDig(n.supplier_cnpj) && k.number === String(Number(n.number)) && k.series === String(Number(n.series)) ? 'ok' : 'erro', 'Chave confere com CNPJ, número e série da nota.');
  } else add('aviso', 'Sem chave de acesso: não dá para conferir a nota.');
  const c = soDig(n.supplier_cnpj);
  if (c.length === 14) {
    if (!cnpjValido(c)) add('erro', 'CNPJ do fornecedor inválido.');
    else { const rf = await buscarCnpj(c); if (!rf) add('aviso', 'CNPJ do fornecedor não encontrado na Receita (ou consulta indisponível).'); else add(rf.situacao.includes('ativa') ? 'ok' : 'erro', `Fornecedor na Receita: ${rf.nome} (situação: ${rf.situacao}).`); }
  }
  if (n.source === 'xml') {
    const minha = soDig(S.empresa?.cnpj);
    if (minha) add(x.destCnpj === minha ? 'ok' : 'erro', x.destCnpj === minha ? 'Nota emitida para a HIGIVARO.' : `Nota emitida para OUTRO destinatário (${formatarDoc(x.destCnpj) || 'sem CNPJ'}).`);
    add(x.ambiente === '1' ? 'ok' : 'erro', x.ambiente === '1' ? 'Nota de produção (com valor fiscal).' : 'Nota de HOMOLOGAÇÃO/teste: SEM valor fiscal.');
    if (x.protStatus) add(['100', '150'].includes(x.protStatus) ? 'ok' : 'erro', `Protocolo da SEFAZ: ${x.protStatus} – ${x.protMotivo || ''} ${x.protNumero ? '(nº ' + x.protNumero + ')' : ''}`);
    else add('aviso', 'XML sem protocolo de autorização da SEFAZ (peça ao fornecedor o XML "procNFe" autorizado).');
    add(x.assinado ? 'ok' : 'aviso', x.assinado ? 'XML assinado digitalmente pelo emissor.' : 'XML sem assinatura digital.');
    const somaItens = d.itens.reduce((s, i) => s + (i.vProd || 0), 0);
    if (x.vProd) add(Math.abs(somaItens - x.vProd) < 0.05 ? 'ok' : 'erro', `Soma dos itens (${brl(somaItens)}) ${Math.abs(somaItens - x.vProd) < 0.05 ? 'confere' : 'NÃO confere'} com o total dos produtos (${brl(x.vProd)}).`);
    const somaParc = d.parcelas.reduce((s, p) => s + p.amount, 0);
    if (d.parcelas.length) add(Math.abs(somaParc - n.total) < 0.05 ? 'ok' : 'aviso', `Parcelas somam ${brl(somaParc)} (total da nota ${brl(n.total)}).`);
  }
  add('info', 'Situação atual na SEFAZ (cancelada, denegada): consulta oficial com o certificado A1 — etapa 2.');
  return r;
}
// PDF do DANFE: lê o texto e procura a chave, o fornecedor ("Recebemos de ..."), a data e o valor total. Os itens são conferidos na revisão.
async function lerPdfDanfe(arq) {
  await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arq.arrayBuffer()) }).promise;
  let texto = '';
  for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) texto += (await (await pdf.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ') + '\n';
  const t = texto.replace(/\s+/g, ' ');
  const chave = (t.match(/(?:\d{4}\s?){10}\d{4}/g) || []).map(soDig).find((c) => c.length === 44) || '';
  const base = dadosDaChave(chave) || {};
  const nome = (t.match(/RECEBEMOS DE (.+?) OS PRODUTOS/i) || [])[1] || '';
  const data = (t.match(/DATA DA EMISS[ÃA]O\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || t.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';
  const total = (t.match(/VALOR TOTAL DA NOTA\s*:?\s*R?\$?\s*([\d.]+,\d{2})/i) || [])[1] || '';
  return { nota: { ...base, supplier_name: nome.trim(), issue_date: data ? data.split('/').reverse().join('-') : '', total: total ? num(total) : 0, source: 'pdf' }, itens: [], parcelas: [], texto: !!t.trim() };
}
// Foto da nota: lê o código de barras da chave (Code-128) com o leitor do navegador ou com a ZXing.
async function lerFotoDanfe(arq) {
  const url = URL.createObjectURL(arq);
  try {
    if ('BarcodeDetector' in window) {
      try { const img = await createImageBitmap(arq); const r = await new BarcodeDetector({ formats: ['code_128'] }).detect(img); const c = r.map((x) => soDig(x.rawValue)).find((x) => x.length === 44); if (c) return c; } catch { /* tenta ZXing */ }
    }
    await carregarScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js');
    const r = await new ZXing.BrowserMultiFormatReader().decodeFromImageUrl(url);
    const c = soDig(r.getText()); return c.length === 44 ? c : '';
  } catch { return ''; } finally { URL.revokeObjectURL(url); }
}
async function telaNotas(modo) {
  if (!ehAdmin()) { app.innerHTML = '<p class="vazio">Notas fiscais: acesso restrito ao administrador.</p>'; return; }
  const topo = secao('notas', '#/notas/' + modo);
  if (modo === 'lista') {
    const ns = await ok(sb.from('purchase_invoices').select('id,number,series,issue_date,supplier_name,supplier_cnpj,total,items_count,source,created_at').order('created_at', { ascending: false }).limit(300));
    app.innerHTML = `${topo}<div class="tabela"><table><thead><tr><th>Emissão</th><th>NF</th><th>Fornecedor</th><th class="esconde-cel">Itens</th><th class="esconde-cel">Origem</th><th class="num">Total</th></tr></thead><tbody>
      ${ns.map((n) => `<tr class="clica" onclick="location.hash='#/nota/${n.id}'"><td>${dataBR(n.issue_date)}</td><td>${esc(n.number || '')}${n.series ? '/' + esc(n.series) : ''}</td><td>${esc(n.supplier_name || '')}<br><small style="color:var(--muted)">${esc(n.supplier_cnpj || '')}</small></td><td class="esconde-cel">${n.items_count}</td><td class="esconde-cel">${esc(n.source.toUpperCase())}</td><td class="num"><b>${brl(n.total)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma nota de entrada lançada ainda.</td></tr>'}</tbody></table></div>`;
    return;
  }
  if (modo === 'xml') {
    app.innerHTML = `${topo}<div class="card"><h2 style="margin-top:0">Entrada por XML</h2>
      <p>Escolha o arquivo <b>XML</b> da nota de compra (o fornecedor manda por e-mail junto com a nota). O sistema lê fornecedor, itens, custos e parcelas, e você confere antes de dar entrada.</p>
      <label class="btn azul grande" style="margin:0">📂 Escolher arquivo XML<input type="file" id="arq" accept=".xml,text/xml,application/xml" hidden></label></div><div id="rev"></div>`;
    $('#arq').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { revisarNota(lerXmlNfe(await f.text())); } catch (err) { falhou(err); }
    };
    return;
  }
  // PDF ou foto
  app.innerHTML = `${topo}<div class="card"><h2 style="margin-top:0">Entrada por PDF ou foto da nota</h2>
    <p>O sistema lê a <b>chave de acesso</b> (no PDF pelo texto, na foto pelo código de barras) e, com ela, o fornecedor, o número e o total. <b>Os itens você confere ou lança</b> na tela seguinte.</p>
    <div class="acoes"><label class="btn azul" style="margin:0">📄 Escolher PDF<input type="file" id="pdf" accept="application/pdf,.pdf" hidden></label>
    <label class="btn azul" style="margin:0">📷 Foto da nota<input type="file" id="foto" accept="image/*" capture="environment" hidden></label></div>
    <label>Ou digite a chave de acesso (44 números)</label><div class="linha"><input id="chave" inputmode="numeric" placeholder="0000 0000 0000 ..."><button class="btn" id="usarChave" style="flex:0 0 auto">Usar chave</button></div>
    <p id="pst" style="color:var(--muted)"></p></div><div id="rev"></div>`;
  const comChave = async (dados) => {
    if (dados.nota.supplier_cnpj && !dados.nota.supplier_name) { const r = await buscarCnpj(soDig(dados.nota.supplier_cnpj)); if (r) dados.nota.supplier_name = r.nome; }
    if (dados.nota.total && !dados.parcelas.length) dados.parcelas = [{ due_date: new Date(Date.now() + 30 * 864e5).toLocaleDateString('sv-SE'), amount: dados.nota.total }];
    revisarNota(dados);
  };
  $('#pdf').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; $('#pst').textContent = 'Lendo o PDF…';
    try { const d = await lerPdfDanfe(f); $('#pst').textContent = d.nota.access_key ? 'Chave encontrada: ' + d.nota.access_key : (d.texto ? 'Não achei a chave no PDF. Digite a chave abaixo ou continue preenchendo à mão.' : 'Este PDF é uma imagem escaneada; use "Foto da nota" ou digite a chave.'); await comChave(d); } catch (err) { falhou(err); }
  };
  $('#foto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; $('#pst').textContent = 'Lendo o código de barras da foto…';
    const ch = await lerFotoDanfe(f);
    if (!ch) { $('#pst').textContent = 'Não consegui ler o código de barras. Tire a foto mais de perto, com boa luz e o código reto, ou digite a chave.'; return; }
    $('#pst').textContent = 'Chave lida: ' + ch; await comChave({ nota: { ...dadosDaChave(ch), source: 'foto', total: 0 }, itens: [], parcelas: [] });
  };
  $('#usarChave').onclick = async () => {
    const d = dadosDaChave($('#chave').value); if (!d) return aviso('A chave precisa ter 44 números.', true);
    await comChave({ nota: { ...d, source: 'manual', total: 0 }, itens: [], parcelas: [] });
  };
}
// Sugestões do estoque para um item da nota: separa as palavras importantes da descrição (tira "de", "cx", "c/"…),
// busca produtos que tenham qualquer uma delas e ordena pelos que têm mais palavras em comum (tamanho como "5l" vale mais).
const PALAVRAS_FRACAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'c', 'com', 'cx', 'caixa', 'un', 'und', 'unid', 'pct', 'pc', 'fd', 'fardo', 'emb', 'para', 'p', 'tipo', 'novo', 'nova', 'item', 'teste']);
async function sugerirProdutos(desc) {
  const palavras = [...new Set(semAcento(desc).replace(/[^a-z0-9,]+/g, ' ').split(' ').map((w) => w.replace(/,/g, '')).filter((w) => w.length >= 2 && !PALAVRAS_FRACAS.has(w)))].slice(0, 8);
  if (!palavras.length) return [];
  const ps = await ok(sb.from('products').select('id,code,description,brand,unit,stock,price,cost,busca').or(palavras.map((w) => `busca.ilike.%${w}%`).join(',')).limit(80));
  const medida = (w) => /\d/.test(w);
  const pont = ps.map((p) => ({ p, s: palavras.reduce((s, w) => s + (p.busca.includes(w) ? (medida(w) ? 2 : 1) : 0), 0) }));
  const minimo = palavras.length >= 2 ? 2 : 1;
  return pont.filter((x) => x.s >= minimo).sort((a, b) => b.s - a.s || a.p.price - b.p.price).slice(0, 5).map((x) => x.p);
}
// Percentuais de preço do item: do XML (frete/imposto destacados) > do produto ligado > padrão do Admin.
function aplicarPercentuais(it, trocouProduto = false) {
  const pad = padroesPreco(), p = it.produto || {};
  if (trocouProduto || it.margin_pct == null) {
    it.freight_pct = it.xmlFrete ?? p.freight_pct ?? pad.freight_pct; it.tax_pct = it.xmlImposto ?? p.tax_pct ?? pad.tax_pct;
    it.other_pct = p.other_pct ?? pad.other_pct; it.margin_pct = p.margin_pct ?? pad.margin_pct;
  }
  it.precoManual = false; it.sale_price = it.acao === 'ligar' && p.price ? Number(p.price) : sugerido(it); it.update_price = false;
}
// Preço sugerido na entrada de nota: mesma formação de preço do cadastro (impostos automáticos + padrões do Admin).
const sugerido = (it) => calcPreco((it.unit_cost || 0) / (it.factor || 1), { ...pricingPadrao(it.produto || {}), frete: it.freight_pct, ipi: it.tax_pct, st: 0, outros_c: it.other_pct, margem: it.margin_pct }).preco;
const dec = (x) => (x == null || x === '' ? '' : String(x).replace('.', ','));
// Linha de lote/validade e formação de preço de cada item da nota.
function linhaPreco(it) {
  const sug = sugerido(it), ligado = it.acao === 'ligar' && it.produto;
  return `<div class="linha preco-item">
    <div style="flex:0 1 120px"><label>Lote *</label><input data-c="lot" class="${it.lot ? '' : 'falta'}" value="${esc(it.lot || '')}"></div>
    <div style="flex:0 1 150px"><label>Validade *</label><input type="date" data-c="expiry" class="${it.expiry ? '' : 'falta'}" value="${esc(it.expiry || '')}"></div>
    <div style="flex:0 1 80px"><label>Frete %</label><input data-c="freight_pct" inputmode="decimal" value="${dec(it.freight_pct)}"></div>
    <div style="flex:0 1 100px"><label>Imp. compra %</label><input data-c="tax_pct" inputmode="decimal" value="${dec(it.tax_pct)}"></div>
    <div style="flex:0 1 80px"><label>Outros %</label><input data-c="other_pct" inputmode="decimal" value="${dec(it.other_pct)}"></div>
    <div style="flex:0 1 90px"><label>Margem % *</label><input data-c="margin_pct" inputmode="decimal" class="${it.margin_pct === '' || it.margin_pct == null ? 'falta' : ''}" value="${dec(it.margin_pct)}"></div>
    <div style="flex:0 1 130px"><label>Preço venda *</label><input data-c="sale_price" inputmode="decimal" class="${it.sale_price > 0 ? '' : 'falta'}" value="${dec(it.sale_price)}"></div>
  </div>
  <div class="dica" style="margin:4px 0">Preço sugerido: <b>${brl(sug)}</b> <button type="button" class="btn" data-usar="1" style="padding:2px 10px;margin-left:6px">Usar</button>
    ${ligado ? ` · preço atual do produto: <b>${brl(it.produto.price)}</b> <label style="display:inline-flex;gap:6px;align-items:center;margin:0 0 0 10px;color:var(--ink)"><input type="checkbox" data-c="update_price" style="width:auto" ${it.update_price ? 'checked' : ''}> atualizar o preço de venda</label>` : ''}</div>`;
}

// Revisão antes de dar entrada: liga cada item a um produto, define o fator (ex.: CX com 12 = 12) e as parcelas do contas a pagar.
async function revisarNota(dados) {
  const n = dados.nota, itens = dados.itens, parcelas = dados.parcelas;
  if (n.access_key) { const ja = await ok(sb.from('purchase_invoices').select('id,number').eq('access_key', n.access_key).maybeSingle()); if (ja) { aviso('Esta nota já foi lançada (NF ' + ja.number + ').', true); location.hash = '#/nota/' + ja.id; return; } }
  // Liga automaticamente: 1) o mesmo item já veio deste fornecedor antes; 2) mesmo código de barras.
  const cnpj = n.supplier_cnpj || '';
  for (const it of itens) {
    let pid = null, fator = 1;
    if (it.supplier_code && cnpj) {
      const ant = await ok(sb.from('purchase_items').select('product_id,factor,purchase_invoices!inner(supplier_cnpj)').eq('supplier_code', it.supplier_code).eq('purchase_invoices.supplier_cnpj', cnpj).not('product_id', 'is', null).limit(1));
      if (ant[0]) { pid = ant[0].product_id; fator = Number(ant[0].factor) || 1; }
    }
    if (!pid && it.ean) { const p = await ok(sb.from('products').select('id').eq('ean', it.ean).limit(1)); if (p[0]) pid = p[0].id; }
    it.factor = fator; it.acao = pid ? 'ligar' : 'escolher';
    if (pid) it.produto = (await ok(sb.from('products').select('*').eq('id', pid).single()));
    else { it.sugestoes = await sugerirProdutos(it.description); if (!it.sugestoes.length) it.acao = 'novo'; }
    aplicarPercentuais(it);
  }
  const conferencia = await conferirNota(dados); n.checks = conferencia;
  S.sujo = true; // nota carregada e ainda não lançada: sair pede confirmação
  const fonte = { xml: 'XML', pdf: 'PDF', foto: 'foto', manual: 'chave digitada' }[n.source] || n.source;
  const icone_ = { ok: '✅', erro: '❌', aviso: '⚠️', info: 'ℹ️' };
  $('#rev').innerHTML = `<div class="card conferencia"><h2 style="margin-top:0">Conferência da nota</h2>${conferencia.map((c) => `<div class="conf-${c.st}">${icone_[c.st]} ${esc(c.txt)}</div>`).join('')}</div>
  <div class="card"><h2 style="margin-top:0">Conferir nota antes de dar entrada <small style="color:var(--muted);font-weight:400">(lida do ${fonte})</small></h2>
    <div class="linha"><div style="flex:2 1 260px"><label>Fornecedor</label><input id="nForn" value="${esc(n.supplier_name)}"></div><div><label>CNPJ</label><input id="nCnpj" value="${esc(n.supplier_cnpj)}"></div></div>
    <div class="linha"><div><label>Nº da NF</label><input id="nNum" value="${esc(n.number)}"></div><div><label>Série</label><input id="nSerie" value="${esc(n.series)}"></div><div><label>Emissão</label><input type="date" id="nData" value="${esc(n.issue_date)}"></div><div><label>Valor total (R$)</label><input id="nTotal" inputmode="decimal" value="${String(n.total || '').replace('.', ',')}"></div></div>
    ${n.access_key ? `<p style="color:var(--muted);margin:8px 0 0">Chave: ${esc(n.access_key)} · <a href="https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=" target="_blank" id="abrirSefaz">consultar na SEFAZ</a> (a chave é copiada; cole lá e resolva o "não sou robô")</p>` : ''}
  </div>
  <div class="card"><h2 style="margin-top:0">Itens</h2><p style="color:var(--muted);margin-top:0">Para cada item: ligue a um produto seu ou cadastre como novo. <b>Fator</b> = quantas unidades do seu estoque vêm em 1 unidade da nota (ex.: caixa com 12 → 12).</p>
    <div id="itens"></div>
    <div style="position:relative;margin-top:10px"><input id="addItem" placeholder="＋ Adicionar item (palavras-chave do produto)"><div id="sugAdd"></div></div></div>
  <div class="card"><h2 style="margin-top:0">Contas a pagar</h2><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="lancar" style="width:auto" ${parcelas.length ? 'checked' : ''}> Lançar as parcelas em Despesas (a pagar)</label>
    <div id="parcs"></div><button class="btn" id="maisParc" style="margin-top:8px">＋ Parcela</button></div>
  <div class="acoes"><button class="btn pri grande" id="confirmar">Dar entrada no estoque</button></div>`;
  $('#rev').scrollIntoView({ behavior: 'smooth' });
  if ($('#abrirSefaz')) $('#abrirSefaz').onclick = () => { navigator.clipboard?.writeText(n.access_key).catch(() => {}); };
  const desenharItens = () => {
    $('#itens').innerHTML = itens.length ? itens.map((it, k) => `<div class="item-nota" data-k="${k}">
      <div><b>${esc(it.description)}</b><br><small style="color:var(--muted)">${it.supplier_code ? 'cód. fornecedor ' + esc(it.supplier_code) : ''}${it.ean ? ' · EAN ' + esc(it.ean) : ''}</small></div>
      <div class="linha" style="margin-top:6px">
        <div style="flex:0 1 90px"><label>Qtd</label><input data-c="quantity" inputmode="decimal" value="${String(it.quantity).replace('.', ',')}"></div>
        <div style="flex:0 1 70px"><label>Un.</label><input data-c="unit" value="${esc(it.unit || '')}"></div>
        <div style="flex:0 1 120px"><label>Custo un. (R$)</label><input data-c="unit_cost" inputmode="decimal" value="${String(it.unit_cost).replace('.', ',')}"></div>
        <div style="flex:0 1 80px"><label>Fator</label><input data-c="factor" inputmode="decimal" value="${String(it.factor || 1).replace('.', ',')}"></div>
        <div style="flex:2 1 240px"><label>Produto no seu estoque</label>
          <select data-c="acao"><option value="ligar" ${it.acao === 'ligar' ? 'selected' : ''} ${it.produto ? '' : 'disabled'}>${it.produto ? esc(it.produto.code + ' · ' + it.produto.description) : '(nenhum ligado)'}</option><option value="escolher" ${it.acao === 'escolher' ? 'selected' : ''}>Procurar produto…</option><option value="novo" ${it.acao === 'novo' ? 'selected' : ''}>Cadastrar como produto novo</option><option value="ignorar" ${it.acao === 'ignorar' ? 'selected' : ''}>Não dar entrada neste item</option></select></div>
      </div>
      ${it.acao === 'escolher' && it.sugestoes?.length ? `<div class="sug-estoque"><small><b>Parecidos no seu estoque</b> (clique no certo):</small>${it.sugestoes.map((p, j) => `<button type="button" class="chip ${j === 0 ? 'melhor' : ''}" data-sug="${j}">${esc(p.code)} · ${esc(p.description)}${p.brand ? ' · ' + esc(p.brand) : ''} <small>(estoque ${p.stock})</small></button>`).join('')}</div>` : ''}
      ${it.acao === 'novo' && !it.produto && it.sugestoes && !it.sugestoes.length ? '<p class="dica">Nenhum produto parecido no seu estoque: provavelmente é <b>produto novo</b>. Confira a descrição e o preço abaixo.</p>' : ''}
      ${it.acao === 'escolher' ? `<div style="position:relative"><input class="buscaProd" placeholder="${it.sugestoes?.length ? 'Não é nenhum destes? Busque por palavras-chave' : 'Palavras-chave do seu produto'}" value="${esc(it.busca || '')}"><div class="sugProd"></div></div>` : ''}
      ${it.acao === 'novo' ? `<div class="linha"><div style="flex:2 1 240px"><label>Descrição do produto novo *</label><input data-c="novoDesc" class="${(it.novoDesc ?? it.description) ? '' : 'falta'}" value="${esc(it.novoDesc ?? it.description)}"></div><div><label>Marca *</label><input data-c="novoMarca" class="${it.novoMarca ? '' : 'falta'}" value="${esc(it.novoMarca || '')}"></div><div style="flex:0 1 110px"><label>Unidade *</label><input data-c="novoUnid" class="${it.novoUnid ? '' : 'falta'}" value="${esc(it.novoUnid ?? '')}" placeholder="UND"></div></div>` : ''}
      ${it.acao !== 'ignorar' ? linhaPreco(it) : ''}
      <small style="color:var(--muted)">Entra no estoque: <b>${(num(String(it.quantity).replace('.', ',')) * (it.factor || 1)).toLocaleString('pt-BR')}</b> ${it.acao === 'ignorar' ? '(ignorado)' : ''} · custo por unidade de estoque: <b>${brl(it.unit_cost / (it.factor || 1))}</b></small>
      <button class="btn perigo" data-x="${k}" style="float:right;padding:4px 10px">✕</button></div>`).join('') : '<p class="vazio">Nenhum item ainda. Use “Adicionar item” abaixo.</p>';
    $$('#itens [data-c]').forEach((el) => (el.onchange = () => {
      const it = itens[el.closest('[data-k]').dataset.k], c = el.dataset.c;
      it[c] = el.type === 'checkbox' ? el.checked : ['quantity', 'unit_cost', 'factor', 'freight_pct', 'tax_pct', 'other_pct', 'margin_pct', 'sale_price'].includes(c) ? num(el.value) : el.value;
      if (['unit_cost', 'factor', 'freight_pct', 'tax_pct', 'other_pct', 'margin_pct'].includes(c) && !it.precoManual && it.acao !== 'ligar') it.sale_price = sugerido(it);
      if (c === 'sale_price') { it.precoManual = true; if (it.acao === 'ligar') it.update_price = true; }
      if (c === 'factor' && !it.factor) it.factor = 1;
      desenharItens();
    }));
    $$('#itens [data-x]').forEach((b) => (b.onclick = () => { itens.splice(b.dataset.x, 1); desenharItens(); }));
    $$('#itens [data-sug]').forEach((b) => (b.onclick = () => { const it = itens[b.closest('[data-k]').dataset.k]; it.produto = it.sugestoes[b.dataset.sug]; it.acao = 'ligar'; aplicarPercentuais(it, true); desenharItens(); }));
    $$('#itens [data-usar]').forEach((b) => (b.onclick = () => { const it = itens[b.closest('[data-k]').dataset.k]; it.sale_price = sugerido(it); it.precoManual = false; if (it.acao === 'ligar') it.update_price = true; S.sujo = true; desenharItens(); }));
    $$('#itens .buscaProd').forEach((inp) => {
      let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
        const it = itens[inp.closest('[data-k]').dataset.k]; it.busca = inp.value; const box = inp.nextElementSibling;
        if (inp.value.trim().length < 2) return (box.innerHTML = '');
        const ps = await buscarProdutos(inp.value, 10);
        box.innerHTML = `<div class="sugestoes">${ps.map((p) => `<div data-id="${p.id}"><b>${esc(p.code)} · ${esc(p.description)}</b><br><small>${esc(p.brand || '')} · estoque ${p.stock} · ${brl(p.price)}</small></div>`).join('') || '<div>Nada encontrado</div>'}</div>`;
        box.querySelectorAll('[data-id]').forEach((d) => (d.onclick = () => { it.produto = ps.find((p) => p.id === d.dataset.id); it.acao = 'ligar'; aplicarPercentuais(it, true); desenharItens(); }));
      }, 250); };
    });
  };
  let ta; $('#addItem').oninput = () => { clearTimeout(ta); ta = setTimeout(async () => {
    const v = $('#addItem').value; if (v.trim().length < 2) return ($('#sugAdd').innerHTML = '');
    const ps = await buscarProdutos(v, 10);
    $('#sugAdd').innerHTML = `<div class="sugestoes">${ps.map((p) => `<div data-id="${p.id}"><b>${esc(p.code)} · ${esc(p.description)}</b><br><small>${esc(p.brand || '')} · estoque ${p.stock} · custo atual ${p.cost != null ? brl(p.cost) : '—'}</small></div>`).join('') || '<div>Nada encontrado</div>'}</div>`;
    $$('#sugAdd [data-id]').forEach((d) => (d.onclick = () => { const p = ps.find((x) => x.id === d.dataset.id); itens.push({ description: p.description, unit: p.unit, quantity: 1, unit_cost: Number(p.cost || 0), factor: 1, acao: 'ligar', produto: p }); aplicarPercentuais(itens[itens.length - 1], true); $('#addItem').value = ''; $('#sugAdd').innerHTML = ''; desenharItens(); }));
  }, 250); };
  const desenharParcs = () => {
    $('#parcs').innerHTML = parcelas.map((p, k) => `<div class="linha" data-p="${k}"><div style="flex:0 1 180px"><label>Vencimento</label><input type="date" data-c="due_date" value="${esc(p.due_date)}"></div><div style="flex:0 1 160px"><label>Valor (R$)</label><input data-c="amount" inputmode="decimal" value="${String(p.amount).replace('.', ',')}"></div><button class="btn perigo" data-xp="${k}" style="flex:0 0 auto;align-self:flex-end">✕</button></div>`).join('') || '<p class="vazio" style="padding:6px">Sem parcelas.</p>';
    $$('#parcs [data-c]').forEach((el) => (el.onchange = () => { const p = parcelas[el.closest('[data-p]').dataset.p]; p[el.dataset.c] = el.dataset.c === 'amount' ? num(el.value) : el.value; }));
    $$('#parcs [data-xp]').forEach((b) => (b.onclick = () => { parcelas.splice(b.dataset.xp, 1); desenharParcs(); }));
  };
  $('#maisParc').onclick = () => { parcelas.push({ due_date: new Date(Date.now() + 30 * 864e5).toLocaleDateString('sv-SE'), amount: 0 }); $('#lancar').checked = true; desenharParcs(); };
  desenharItens(); desenharParcs();
  $('#confirmar').onclick = async () => {
    const pend = itens.filter((it) => it.acao === 'escolher' || (it.acao === 'ligar' && !it.produto));
    if (pend.length) return aviso(`Falta escolher o produto de ${pend.length} item(ns), ou marque "Não dar entrada".`, true);
    if (!itens.some((it) => it.acao !== 'ignorar')) return aviso('Nenhum item para dar entrada.', true);
    const faltas = [];
    itens.forEach((it, k) => { if (it.acao === 'ignorar') return; const nome = `item ${k + 1}`;
      if (!(it.quantity > 0)) faltas.push(nome + ': quantidade'); if (!(it.unit_cost > 0)) faltas.push(nome + ': custo');
      if (!(it.sale_price > 0)) faltas.push(nome + ': preço de venda'); if (it.margin_pct === '' || it.margin_pct == null) faltas.push(nome + ': margem');
      if (!String(it.lot || '').trim()) faltas.push(nome + ': lote'); if (!it.expiry) faltas.push(nome + ': validade');
      if (it.acao === 'novo') { if (!String(it.novoDesc ?? it.description).trim()) faltas.push(nome + ': descrição'); if (!String(it.novoMarca || '').trim()) faltas.push(nome + ': marca'); if (!String(it.novoUnid || '').trim()) faltas.push(nome + ': unidade'); } });
    if (!$('#nForn').value.trim()) faltas.push('nota: fornecedor'); if (!$('#nNum').value.trim()) faltas.push('nota: número'); if (!$('#nData').value) faltas.push('nota: data de emissão'); if (!num($('#nTotal').value)) faltas.push('nota: valor total');
    if (faltas.length) { desenharItens(); return aviso('Preencha antes de dar entrada: ' + faltas.slice(0, 6).join('; ') + (faltas.length > 6 ? ` (e mais ${faltas.length - 6})` : ''), true); }
    if (conferencia.some((c) => c.st === 'erro') && !confirm('A conferência encontrou problemas (❌) nesta nota. Dar entrada mesmo assim?')) return;
    const payload = {
      nota: { ...n, supplier_name: $('#nForn').value.trim().toUpperCase(), supplier_cnpj: $('#nCnpj').value.trim(), number: $('#nNum').value.trim(), series: $('#nSerie').value.trim(), issue_date: $('#nData').value, total: num($('#nTotal').value) },
      itens: itens.filter((it) => it.acao !== 'ignorar').map((it) => ({ product_id: it.acao === 'ligar' ? it.produto.id : null, ...(it.acao === 'novo' ? { novo: { description: it.novoDesc ?? it.description, brand: it.novoMarca || '', unit: it.novoUnid || 'UND' } } : {}),
        supplier_code: it.supplier_code || '', ean: it.ean || '', description: it.description, unit: it.unit, quantity: it.quantity, unit_cost: it.unit_cost, factor: it.factor || 1,
        lot: it.lot || '', expiry: it.expiry || '', freight_pct: num(it.freight_pct), tax_pct: num(it.tax_pct), other_pct: num(it.other_pct), margin_pct: num(it.margin_pct), sale_price: it.sale_price, update_price: it.acao === 'ligar' ? !!it.update_price : true })),
      parcelas: $('#lancar').checked ? parcelas.filter((p) => p.amount > 0 && p.due_date) : [],
    };
    const totEst = payload.itens.reduce((s, i) => s + i.quantity * i.factor, 0);
    if (!confirm(`Dar entrada de ${payload.itens.length} item(ns) (${totEst.toLocaleString('pt-BR')} unidades no estoque)${payload.parcelas.length ? ' e lançar ' + payload.parcelas.length + ' parcela(s) em Despesas' : ''}?`)) return;
    const b = $('#confirmar'); b.disabled = true;
    try { const id = await ok(sb.rpc('registrar_entrada', { p: payload })); aviso('Entrada registrada. Estoque atualizado.'); location.hash = '#/nota/' + id; } catch (e) { falhou(e); b.disabled = false; }
  };
}
async function telaNotaEntrada(id) {
  if (!ehAdmin()) { app.innerHTML = '<p class="vazio">Acesso restrito ao administrador.</p>'; return; }
  const [n, its] = await Promise.all([ok(sb.from('purchase_invoices').select('*').eq('id', id).single()), ok(sb.from('purchase_items').select('*, products(code,description)').eq('invoice_id', id))]);
  app.innerHTML = `${secao('notas', '#/notas/lista')}
  <div class="card"><h2 style="margin-top:0">NF ${esc(n.number || '')}${n.series ? ' / série ' + esc(n.series) : ''} · ${esc(n.supplier_name || '')}</h2>
    ${esc(n.supplier_cnpj || '')} · emissão ${dataBR(n.issue_date)} · total <b>${brl(n.total)}</b> · lançada por ${esc(n.created_by || '')} em ${new Date(n.created_at).toLocaleDateString('pt-BR')} (origem: ${esc(n.source.toUpperCase())})
    ${n.access_key ? `<br><small style="color:var(--muted)">Chave: ${esc(n.access_key)}</small>` : ''}
    <div class="acoes">${n.xml ? '<button class="btn" id="baixarXml">Baixar XML</button>' : ''}<button class="btn perigo" id="estornar">Excluir nota (desfazer entrada)</button></div></div>
  ${Array.isArray(n.checks) && n.checks.length ? `<div class="card conferencia"><h2 style="margin-top:0">Conferência feita na entrada</h2>${n.checks.map((c) => `<div class="conf-${c.st}">${{ ok: '✅', erro: '❌', aviso: '⚠️', info: 'ℹ️' }[c.st] || ''} ${esc(c.txt)}</div>`).join('')}</div>` : ''}
  <div class="tabela"><table><thead><tr><th>Item da nota</th><th class="num">Qtd</th><th class="num">Custo un.</th><th class="num">Fator</th><th class="esconde-cel">Lote / validade</th><th class="esconde-cel">Frete / imp. / outros / margem</th><th class="num">Preço venda</th><th>Produto no estoque</th><th class="num">Entrou</th></tr></thead><tbody>
  ${its.map((i) => `<tr><td>${esc(i.description)}<br><small style="color:var(--muted)">${esc(i.supplier_code || '')} ${esc(i.unit || '')}</small></td><td class="num">${i.quantity}</td><td class="num">${brl(i.unit_cost)}</td><td class="num">${i.factor}</td>
    <td class="esconde-cel">${esc(i.lot || '—')}<br><small>${i.expiry ? 'val. ' + dataBR(i.expiry) : ''}</small></td><td class="esconde-cel"><small>${[i.freight_pct, i.tax_pct, i.other_pct, i.margin_pct].map((x) => (x == null ? '—' : String(x).replace('.', ',') + '%')).join(' / ')}</small></td>
    <td class="num">${i.sale_price != null ? brl(i.sale_price) : '—'}</td><td>${i.products ? esc(i.products.code + ' · ' + i.products.description) : '<span style="color:var(--muted)">—</span>'}</td><td class="num"><b>${i.stock_added}</b></td></tr>`).join('')}</tbody></table></div>`;
  $('#estornar').onclick = async () => {
    if (!confirm(`Excluir a NF ${n.number || ''} de ${n.supplier_name || ''}?\n\nO estoque que entrou por ela será retirado e as parcelas lançadas em Despesas serão apagadas. Produtos cadastrados por ela continuam cadastrados.`)) return;
    try { await ok(sb.rpc('estornar_entrada', { p_id: id })); aviso('Nota excluída e entrada desfeita.'); location.hash = '#/notas/lista'; } catch (e) { falhou(e); }
  };
  if ($('#baixarXml')) $('#baixarXml').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([n.xml], { type: 'text/xml' })); a.download = `NF-${n.number || 'entrada'}.xml`; a.click(); };
}

// ---------- admin ----------
async function telaAdmin(modo) {
  if (!ehAdmin()) { app.innerHTML = '<p class="vazio">Acesso restrito ao administrador.</p>'; return; }
  const [e, us] = await Promise.all([ok(sb.from('company_settings').select('*').eq('id', 1).single()), ok(sb.from('profiles').select('*').order('created_at'))]);
  const campo = (n, rot, extra = '') => `<div><label>${rot}</label><input name="${n}" value="${esc(e[n] ?? '')}" ${extra}></div>`;
  app.innerHTML = `${secao('admin', '#/admin/' + modo)}
  <div class="card" ${modo === 'empresa' ? '' : 'hidden'}><h2 style="margin-top:0">Empresa</h2><form id="fe"><div class="linha">${campo('name', 'Nome')}${campo('cnpj', 'CNPJ')}</div><div class="linha">${campo('phone', 'Telefone')}${campo('email', 'E-mail')}</div>
  <div class="linha">${campo('address', 'Endereço')}${campo('monthly_goal', 'Meta mensal (R$)', 'inputmode="decimal"')}</div>
  <label>Texto padrão no rodapé do orçamento</label><textarea name="observations_text">${esc(e.observations_text || '')}</textarea>
  <p class="dica">A formação de preço (margem, frete, comissão, regime de impostos) agora fica em <a href="#/admin/precos">Admin › Formação de preços</a>.</p>
  <div class="acoes"><button class="btn pri">Salvar empresa</button></div></form></div>
  ${modo === 'precos' ? formPrecosAdmin(e) : ''}
  <div ${modo === 'usuarios' ? '' : 'hidden'}><div class="acoes" style="margin-top:0"><button class="btn pri" id="novoUsuario">＋ Novo usuário</button></div><div id="formUsuario"></div></div>
  <div class="card" ${modo === 'usuarios' ? '' : 'hidden'}><h2 style="margin-top:0">Usuários</h2><p style="color:var(--muted);margin-top:0">Use <b>＋ Novo usuário</b> para cadastrar com e-mail e senha temporária: no primeiro acesso a pessoa é obrigada a criar a senha pessoal. Em <b>Pode acessar</b>, marque as áreas de cada vendedor (administrador acessa tudo; Notas fiscais, Despesas e Admin são só do administrador).</p>
  <div class="tabela"><table><thead><tr><th>Nº login</th><th>Nome</th><th class="esconde-cel">E-mail</th><th>Acesso</th><th>Tipo</th><th>Ativo</th><th>Pode acessar</th><th></th></tr></thead><tbody>
  ${us.map((u) => `<tr data-id="${u.id}"><td><input type="number" min="1" max="99999" data-num="${u.id}" value="${u.login_number ?? ''}" style="width:80px" placeholder="—"></td><td>${esc(u.full_name)}</td><td class="esconde-cel">${esc(u.email)}</td>
    <td><select data-c="access_status" ${u.id === S.perfil.id ? 'disabled' : ''}><option ${u.access_status === 'liberado' ? 'selected' : ''}>liberado</option><option ${u.access_status === 'aguardando' ? 'selected' : ''}>aguardando</option></select></td>
    <td><select data-c="role" ${u.id === S.perfil.id ? 'disabled' : ''}><option value="user" ${u.role === 'user' ? 'selected' : ''}>vendedor</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
    <td><input type="checkbox" data-c="active" ${u.active ? 'checked' : ''} ${u.id === S.perfil.id ? 'disabled' : ''} style="width:auto"></td>
    <td>${u.role === 'admin' ? '<small style="color:var(--muted)">tudo (administrador)</small>' : `<div class="permissoes">${AREAS.map(([a, rot]) => `<label><input type="checkbox" data-perm="${a}" ${(a === 'editar_produtos' ? Array.isArray(u.permissions) && u.permissions.includes(a) : !Array.isArray(u.permissions) || u.permissions.includes(a)) ? 'checked' : ''}> ${rot}</label>`).join('')}</div>`}</td>
    <td>${u.id === S.perfil.id ? '' : `<button class="btn" data-senha="${u.id}" style="padding:5px 10px;font-size:13px">Nova senha temporária</button> <button class="btn perigo" data-apagar="${u.id}" style="padding:5px 10px;font-size:13px">Apagar</button>`}${u.must_change_password ? '<br><small style="color:#9a6700">aguardando criar a senha pessoal</small>' : ''}</td></tr>`).join('')}
  </tbody></table></div></div>`;
  // Senha temporária: 8 caracteres fáceis de ditar (sem 0/O, 1/l), para o admin repassar ao usuário.
  const gerarSenha = () => { const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint32Array(8)); return [...r].map((n) => c[n % c.length]).join(''); };
  const proxNum = Math.max(0, ...us.map((u) => Number(u.login_number) || 0)) + 1;
  // Nº de login de cada usuário: o administrador define; não pode repetir.
  $$('[data-num]').forEach((inp) => (inp.onchange = async () => {
    const v = inp.value ? Number(inp.value) : null;
    if (v != null && us.some((u) => u.id !== inp.dataset.num && Number(u.login_number) === v)) { aviso('O nº ' + v + ' já é de outro usuário.', true); return; }
    try { await ok(sb.from('profiles').update({ login_number: v }).eq('id', inp.dataset.num)); aviso('Nº de login atualizado.'); const u = us.find((x) => x.id === inp.dataset.num); if (u) u.login_number = v; } catch (err) { falhou(err); }
  }));
  $('#novoUsuario').onclick = () => {
    $('#formUsuario').innerHTML = `<div class="card"><h2 style="margin-top:0">Novo usuário</h2><form id="fu">
      <div class="linha"><div style="flex:2 1 240px"><label>Nome *</label><input name="nome" required></div><div style="flex:2 1 240px"><label>E-mail *</label><input name="email" type="email" required autocomplete="off"></div><div style="flex:0 1 140px"><label>Nº de login *</label><input name="numero" type="number" min="1" max="99999" required value="${proxNum}"></div></div>
      <div class="linha"><div><label>Senha temporária * (mínimo 8)</label><div class="linha" style="gap:6px"><input name="senha" id="senhaTemp" required minlength="8" autocomplete="new-password"><button type="button" class="btn" id="gerar" style="flex:0 0 auto">Gerar</button></div></div>
        <div style="flex:0 1 200px"><label>Tipo</label><select name="tipo" id="tipoU"><option value="user">Vendedor</option><option value="admin">Administrador</option></select></div></div>
      <div id="boxPerms"><label>Pode acessar</label><div class="permissoes">${AREAS.map(([a, rot]) => `<label><input type="checkbox" name="perm" value="${a}" ${a === 'editar_produtos' ? '' : 'checked'}> ${rot}</label>`).join('')}</div></div>
      <p class="dica">Passe o e-mail e a senha temporária para a pessoa. No primeiro acesso, o sistema pede para ela criar a própria senha; a temporária deixa de valer.</p>
      <div class="acoes"><button class="btn pri">Criar usuário</button><button type="button" class="btn" id="cancelaU">Cancelar</button></div></form></div>`;
    $('#gerar').onclick = () => { $('#senhaTemp').value = gerarSenha(); S.sujo = true; };
    $('#tipoU').onchange = () => ($('#boxPerms').hidden = $('#tipoU').value === 'admin');
    $('#cancelaU').onclick = () => { $('#formUsuario').innerHTML = ''; S.sujo = false; };
    $('#fu').onsubmit = async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      const perms = f.getAll('perm'); const tipo = f.get('tipo');
      if (tipo !== 'admin' && !perms.length) return aviso('Marque pelo menos uma área que o usuário pode acessar.', true);
      try {
        const numero = Number(f.get('numero'));
        if (us.some((u) => Number(u.login_number) === numero)) return aviso('O nº ' + numero + ' já é de outro usuário.', true);
        const uid = await ok(sb.rpc('admin_criar_usuario', { p_nome: f.get('nome'), p_email: f.get('email'), p_senha: f.get('senha'), p_role: tipo, p_perms: perms }));
        await ok(sb.from('profiles').update({ login_number: numero }).eq('id', uid));
        const email = f.get('email'), senha = f.get('senha');
        aviso('Usuário criado.'); await telaAdmin(modo);
        const bv = await enviarBoasVindas(uid);
        await dialogo(`<h2 style="margin-top:0">Usuário criado ✅</h2><p>Passe estes dados para a pessoa:</p><p style="font-size:17px">Endereço: <b>${esc(location.origin + location.pathname)}</b><br>Nº do usuário: <b>${numero}</b> (ou o e-mail ${esc(email)})<br>Senha temporária: <b>${esc(senha)}</b></p><p class="dica">No primeiro acesso ela vai criar a senha pessoal.</p>
          <p>${bv.ok ? '📧 E-mail de boas-vindas enviado para ' + esc(email) + ' (a senha temporária não vai no e-mail).' : '⚠️ E-mail de boas-vindas não enviado: ' + esc(bv.motivo)}</p>`, 'Entendi');
      } catch (err) { falhou(err); }
    };
    $('#fu').nome.focus();
  };
  $$('[data-apagar]').forEach((b) => (b.onclick = async () => {
    const nome = b.closest('tr').children[1].textContent;
    if (!confirm(`Apagar o usuário ${nome}?\n\nEle(a) não vai mais conseguir entrar. Orçamentos e vendas feitos por ele(a) continuam no sistema. Isto não pode ser desfeito.`)) return;
    try { await ok(sb.rpc('admin_apagar_usuario', { p_user: b.dataset.apagar })); aviso('Usuário apagado.'); await telaAdmin(modo); } catch (err) { falhou(err); }
  }));
  $$('[data-senha]').forEach((b) => (b.onclick = async () => {
    const nova = gerarSenha(); const nome = b.closest('tr').children[1].textContent;
    const r = await dialogo(`<h2 style="margin-top:0">Nova senha temporária</h2><p>Para <b>${esc(nome)}</b>. A senha atual deixa de valer e, no próximo acesso, ele(a) cria uma senha pessoal.</p><label>Senha temporária</label><input id="dSenha" value="${nova}">`, 'Definir senha', () => $('#dSenha').value);
    if (!r) return;
    try { await ok(sb.rpc('admin_senha_temporaria', { p_user: b.dataset.senha, p_senha: r })); aviso('Senha temporária definida.'); await telaAdmin(modo); await dialogo(`<h2 style="margin-top:0">Senha definida ✅</h2><p>Passe para <b>${esc(nome)}</b> a senha temporária: <b style="font-size:18px">${esc(r)}</b></p>`, 'Entendi'); } catch (err) { falhou(err); }
  }));
  $$('[data-perm]').forEach((el) => (el.onchange = async () => {
    const tr = el.closest('tr'); const perms = $$('[data-perm]', tr).filter((x) => x.checked).map((x) => x.dataset.perm);
    try { await ok(sb.from('profiles').update({ permissions: perms }).eq('id', tr.dataset.id)); aviso('Permissões salvas.'); } catch (err) { falhou(err); }
  }));
  if (modo === 'precos') ligarPrecosAdmin(e);
  $('#fe').onsubmit = async (ev) => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); f.monthly_goal = num(f.monthly_goal);
    try { await ok(sb.from('company_settings').update(f).eq('id', 1)); S.empresa = { ...S.empresa, ...f }; aviso('Empresa salva.'); } catch (err) { falhou(err); }
  };
  $$('tr[data-id] [data-c]').forEach((el) => (el.onchange = async () => {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    try { await ok(sb.from('profiles').update({ [el.dataset.c]: v }).eq('id', el.closest('tr').dataset.id)); aviso('Usuário atualizado.'); if (el.dataset.c === 'role') telaAdmin(modo); } catch (err) { falhou(err); }
  }));
}
// E-mail de boas-vindas (função "boas-vindas" no Supabase, envia pelo Gmail da HIGIVARO). Nunca trava o cadastro se falhar.
async function enviarBoasVindas(userId) {
  try {
    const r = await fetch(HGV.url + '/functions/v1/boas-vindas', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: HGV.chave }, body: JSON.stringify({ user_id: userId }) });
    return await r.json();
  } catch (e) { return { ok: false, motivo: 'sem conexão com o serviço de e-mail' }; }
}
// Preço de venda sugerido: custo × (1 + frete% + imposto% + outros%) × (1 + margem%).
const precoSugerido = (custo, f, t, o, m) => Math.round((Number(custo) || 0) * (1 + ((Number(f) || 0) + (Number(t) || 0) + (Number(o) || 0)) / 100) * (1 + (Number(m) || 0) / 100) * 100) / 100;
const padroesPreco = () => { const c = configPreco(); return { margin_pct: c.margem, freight_pct: c.frete, tax_pct: 0, other_pct: c.outros_c }; };
// ---------- Admin › Formação de preços ----------
// Regime tributário (os impostos de venda são calculados sozinhos) e os padrões que todos os produtos seguem.
const CAMPOS_PADRAO = [['custo_op', 'Custo operacional %'], ['comissao', 'Comissão %'], ['outros_v', 'Outros (venda) %'], ['enc_fin', 'Encargos financeiros %'], ['margem', 'Margem de lucro padrão %']];
function formPrecosAdmin(e) {
  const c = configPreco(e), v = (k) => String(c[k]).replace('.', ',');
  const inp = (k, rot) => `<div><label>${rot}</label><input name="${k}" inputmode="decimal" value="${v(k)}"></div>`;
  return `<div class="card"><h2 style="margin-top:0">Formação de preços · padrão para todos os produtos</h2>
  <p style="color:var(--muted);margin-top:0">Preço de venda = custo final ÷ (1 − (impostos + custos de venda + margem) ÷ 100), igual ao ERP. Os <b>impostos de venda</b> (PIS, Cofins, IR, CSLL, ICMS ou Simples) o sistema calcula sozinho pelo regime abaixo e pelo NCM/CSOSN de cada produto. O resto da coluna "Preço de venda" segue estes padrões; em cada produto só a margem pode mudar.</p>
  <form id="fpr">
    <h3>Impostos</h3>
    <div class="linha"><div style="flex:2 1 260px"><label>Regime tributário da HIGIVARO</label><select name="regime">${REGIMES.map(([k, t]) => `<option value="${k}" ${c.regime === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div id="boxSimples"><label>Alíquota efetiva do Simples %</label><input name="simples" inputmode="decimal" value="${v('simples')}"></div>
      <div id="boxIcms"><label>ICMS interno (Bahia) %</label><input name="icms" inputmode="decimal" value="${v('icms')}"></div></div>
    <h3>Coluna "Preço de venda" (vale para todos)</h3>
    <div class="linha">${CAMPOS_PADRAO.map(([k, r]) => inp(k, r)).join('')}</div>
    <h3>Coluna "Custo" (valor inicial de produto novo e entrada de nota)</h3>
    <div class="linha">${inp('frete', 'Frete %')}${inp('outros_c', 'Outros custos %')}</div>
    <p class="dica" id="exPreco"></p>
    <p style="color:var(--muted);font-size:13px">Mudar os padrões não altera o preço já gravado nos produtos: o novo cálculo aparece como sugestão ao abrir cada produto ou na próxima entrada de nota.</p>
    <div class="acoes"><button class="btn pri">Salvar padrões</button></div></form></div>`;
}
function ligarPrecosAdmin(e) {
  const fr = $('#fpr');
  const ler = () => { const d = Object.fromEntries(new FormData(fr)), pd = {}; ['simples', 'icms', 'frete', 'outros_c', ...CAMPOS_PADRAO.map((x) => x[0])].forEach((k) => (pd[k] = num(d[k]))); return { regime: d.regime, pd }; };
  const exemplo = () => {
    const { regime, pd } = ler(); $('#boxSimples').hidden = regime !== 'SIMPLES'; $('#boxIcms').hidden = !['PRESUMIDO', 'REAL'].includes(regime);
    const cfg = configPreco({ ...e, tax_regime: regime, pricing_defaults: pd }), im = impostosVenda({ ncm: '', cst: '102' }, cfg);
    const f = { ...Object.fromEntries(Object.keys(CAMPOS_PRECO).map((k) => [k, 0])), frete: cfg.frete, outros_c: cfg.outros_c, custo_op: cfg.custo_op, comissao: cfg.comissao, outros_v: cfg.outros_v, enc_fin: cfg.enc_fin, margem: cfg.margem, ...im.valores };
    const r = calcPreco(100, f);
    $('#exPreco').innerHTML = r.fator > 0 ? `Exemplo: produto com custo de <b>R$ 100,00</b> → custo final ${brl(r.custoFinal)} · impostos de venda ${String(Math.round((im.valores.trib_fed + im.valores.pis + im.valores.cofins + im.valores.ir + im.valores.csll + im.valores.icms) * 100) / 100).replace('.', ',')}% · fator ${r.fator.toFixed(4).replace('.', ',')} · <b>preço sugerido ${brl(r.preco)}</b> · PMZ ${brl(r.pmz)}.<br><small>${esc(im.notas.join(' · '))}</small>` : '<b style="color:var(--red)">Impostos + custos de venda + margem chegam a 100% ou mais: não dá para formar preço.</b>';
  };
  fr.addEventListener('input', exemplo); fr.addEventListener('change', exemplo); exemplo();
  fr.onsubmit = async (ev) => {
    ev.preventDefault(); const { regime, pd } = ler();
    const upd = { tax_regime: regime, pricing_defaults: pd, default_margin_pct: pd.margem, default_freight_pct: pd.frete, default_other_pct: pd.outros_c, default_tax_pct: 0 };
    if (calcPreco(100, { ...pd, ...impostosVenda({}, configPreco({ ...e, ...upd })).valores }).fator <= 0) return aviso('Impostos + custos de venda + margem passam de 100%.', true);
    try { await ok(sb.from('company_settings').update(upd).eq('id', 1)); S.empresa = { ...S.empresa, ...upd }; aviso('Padrões salvos.'); } catch (err) { falhou(err); }
  };
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
let logoData, logoCor = [2, 32, 66];
async function carregarLogo() {
  if (logoData !== undefined) return logoData;
  // Reduz a logo para JPEG de 360 px: o PDF fica leve (bom para mandar no WhatsApp).
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'logo.png'; });
    // A logo é retangular (3:2): mantém a proporção e boa resolução.
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 600; const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, 900, 600);
    // Cor do fundo da logo (média das bordas) para o cabeçalho emendar sem "caixa" visível.
    const px = [[4, 300], [895, 300], [450, 4], [450, 595]].map(([x, y]) => g.getImageData(x, y, 1, 1).data);
    logoCor = [0, 1, 2].map((k) => Math.round(px.reduce((s, p) => s + p[k], 0) / px.length));
    logoData = cv.toDataURL('image/jpeg', 0.92);
  } catch { logoData = null; }
  return logoData;
}
// Cabeçalho padrão dos PDFs: faixa na cor da logo, logo 3:2, contatos da empresa e título à direita.
function cabecalhoPdf(pdf, c, logo, titulo, linha2, linha3) {
  const M = 12, VERDE = [108, 197, 49];
  const txt = (t, x, y, o = {}) => { pdf.setFont('helvetica', o.b ? 'bold' : 'normal'); pdf.setFontSize(o.s || 9); pdf.setTextColor(...(o.c || [255, 255, 255])); pdf.text(String(t ?? ''), x, y, o.a ? { align: o.a } : undefined); };
  pdf.setFillColor(...logoCor); pdf.rect(0, 0, 210, 40, 'F');
  pdf.setFillColor(...VERDE); pdf.rect(0, 40, 210, 1.4, 'F');
  if (logo) pdf.addImage(logo, 'JPEG', M - 2, 7, 39, 26);
  const xEmp = logo ? M + 44 : M;
  if (logo) { pdf.setDrawColor(60, 95, 140); pdf.setLineWidth(0.3); pdf.line(xEmp - 3, 9, xEmp - 3, 33); }
  else txt(c.name || 'HIGIVARO', xEmp, 15, { s: 18, b: true });
  const contatos = [[c.cnpj && 'CNPJ', c.cnpj], ['WhatsApp', c.phone], ['E-mail', c.email], ['Site', 'higivarooficial.github.io'], [c.address && 'Endereço', c.address]].filter(([r, v]) => r && v);
  contatos.forEach(([r, v], k) => { txt(r.toUpperCase(), xEmp, 12.5 + k * 5.2, { s: 6, b: true, c: [130, 170, 210] }); txt(v, xEmp + 16, 12.5 + k * 5.2, { s: 8, c: [225, 236, 248] }); });
  txt(titulo, 210 - M, 15, { s: titulo.length > 18 ? 12.5 : 15, b: true, a: 'right' });
  if (linha2) txt(linha2, 210 - M, 23, { s: 13, b: true, c: VERDE, a: 'right' });
  if (linha3) txt(linha3, 210 - M, 29.5, { s: 8, c: [220, 232, 245], a: 'right' });
}
function rodapePdf(pdf, c) {
  const M = 12, n = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p); pdf.setDrawColor(223, 231, 240); pdf.setLineWidth(0.3); pdf.line(M, 284, 210 - M, 284);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(47, 134, 222); pdf.text('HIGIVARO  •  Qualidade  •  Variedade  •  Confiança', M, 288.5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(96, 114, 138); pdf.text('WhatsApp ' + (c.phone || '') + '   •   higivarooficial.github.io', M, 292.5);
    pdf.setFontSize(7.5); pdf.text(`Página ${p} de ${n}`, 210 - M, 290.5, { align: 'right' });
  }
}
// Relatório de contas a receber (o que está em aberto), agrupado por vencimento.
async function pdfReceber(vendas, filtro) {
  const c = S.empresa || {};
  const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await carregarLogo();
  const M = 12, L = 186, NAVY = [3, 35, 68], TINTA = [13, 42, 74], CINZA = [96, 114, 138], LINHA = [223, 231, 240], FUNDO = [244, 247, 251], VERMELHO = [200, 55, 55];
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' }).slice(0, 17).replace(',', ' às');
  cabecalhoPdf(pdf, c, logo, 'CONTAS A RECEBER', 'Em aberto', 'Gerado em ' + agora);
  const soma = (l) => l.reduce((s, v) => s + Number(v.total), 0);
  const venc = vendas.filter((v) => diasAtraso(v.due_date) > 0);
  // Quadros de resumo
  let y = 48; const w = (L - 9) / 4;
  [['Total em aberto', brl(soma(vendas)), TINTA], ['Vencido', brl(soma(venc)), VERMELHO], ['A vencer', brl(soma(vendas) - soma(venc)), TINTA], ['Vendas / clientes', `${vendas.length} / ${new Set(vendas.map((v) => v.client_code || v.client_name)).size}`, TINTA]].forEach(([r, v, cor], k) => {
    const x = M + k * (w + 3); pdf.setFillColor(...FUNDO); pdf.setDrawColor(...LINHA); pdf.roundedRect(x, y, w, 17, 2, 2, 'FD');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(...CINZA); pdf.text(r.toUpperCase(), x + 4, y + 6);
    pdf.setFontSize(12); pdf.setTextColor(...cor); pdf.text(v, x + 4, y + 13);
  });
  y += 22;
  if (filtro) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...CINZA); pdf.text(filtro, M, y); y += 4; }
  pdf.autoTable({
    startY: y + 1, margin: { left: M, right: M, top: 20, bottom: 22 },
    head: [['Venda', 'Cód.', 'Cliente', 'Telefone', 'Emissão', 'Vencimento', 'Situação', 'Forma', 'Valor']],
    body: vendas.map((v) => [v.number, v.client_code || '', v.client_name, v.client_phone || '', dataBR(v.date), dataBR(v.due_date), textoPrazo(v.due_date), v.payment_method || '', brl(v.total)]),
    foot: [[{ content: `TOTAL EM ABERTO (${vendas.length} ${vendas.length === 1 ? 'venda' : 'vendas'})`, colSpan: 8, styles: { halign: 'right' } }, brl(soma(vendas))]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.8, cellPadding: { top: 2, bottom: 2, left: 1.6, right: 1.6 }, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 }, valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.3, lineWidth: 0 },
    footStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 250, 253] },
    columnStyles: { 0: { cellWidth: 13 }, 1: { cellWidth: 10, textColor: CINZA }, 3: { cellWidth: 25 }, 4: { cellWidth: 18.5 }, 5: { cellWidth: 19 }, 6: { cellWidth: 26 }, 7: { cellWidth: 17 }, 8: { cellWidth: 22, halign: 'right', fontStyle: 'bold' } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 6) { const t = String(d.cell.raw); d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = t.startsWith('Vencida') ? VERMELHO : t.startsWith('Vence hoje') ? [190, 120, 0] : [60, 140, 30]; } if (d.section === 'head' && d.column.index === 8) d.cell.styles.halign = 'right'; },
    didDrawPage: (d) => { if (d.pageNumber > 1) { pdf.setFillColor(...NAVY); pdf.rect(0, 0, 210, 14, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(255, 255, 255); pdf.text('HIGIVARO  •  Contas a receber  •  ' + agora, M, 9); } },
  });
  if (!vendas.length) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...CINZA); pdf.text('Nenhuma venda em aberto.', 105, y + 25, { align: 'center' }); }
  rodapePdf(pdf, c);
  pdf.save(`Contas-a-receber-${hoje()}.pdf`);
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

  cabecalhoPdf(pdf, c, logo, ehVenda ? 'PEDIDO DE VENDA' : 'ORÇAMENTO', 'Nº ' + doc.number, `Emissão: ${dataBR(doc.date)}${doc.time ? ' às ' + doc.time : ''}`);

  // Quadro do cliente
  let y = 48;
  cor('setFillColor', FUNDO); cor('setDrawColor', LINHA); pdf.setLineWidth(0.3); pdf.roundedRect(M, y, L, 31, 2.5, 2.5, 'FD');
  rotulo(doc.client_code ? 'Cliente  •  código ' + doc.client_code : 'Cliente', M + 5, y + 6);
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
  txt(`Desconto${pct ? ' (' + num(pct) + '%)' : ''}`, xT + 3, y + 11, { s: 9, c: CINZA }); txt(pct ? '- ' + brl(bruto * pct / 100) : brl(0), 210 - M - 3, y + 11, { s: 9, a: 'right', c: pct ? [200, 60, 60] : TINTA });
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
    rotulo('Observações e informações adicionais', M, y + 2); txt(linhas, M, y + 7, { s: 8.3 }); y += 9 + linhas.length * 4;
  }
  if (ehVenda) {
    // Assinaturas: cliente (recebimento) e vendedor, com nome embaixo e data.
    if (y + 40 > 278) { pdf.addPage(); y = 22; }
    txt('Declaro que recebi os produtos acima em perfeito estado e nas quantidades indicadas.', M, y + 6, { s: 8, c: CINZA });
    txt('Data do recebimento: ____ / ____ / ________', M, y + 12, { s: 8, c: CINZA });
    y += 30; const w = (L - 14) / 2; cor('setDrawColor', TINTA); pdf.setLineWidth(0.35);
    [[M, 'ASSINATURA DO CLIENTE', doc.client_name], [M + w + 14, 'ASSINATURA DO VENDEDOR', doc.employee_name]].forEach(([x, r, nome]) => {
      pdf.line(x, y, x + w, y);
      txt(r, x + w / 2, y + 4.5, { s: 6.8, b: true, c: CINZA, a: 'center' });
      txt(pdf.splitTextToSize(String(nome || ''), w)[0] || '', x + w / 2, y + 9, { s: 8.3, a: 'center' });
    });
  }

  // Rodapé com numeração em todas as páginas
  const n = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p);
    cor('setDrawColor', LINHA); pdf.setLineWidth(0.3); pdf.line(M, 284, 210 - M, 284);
    txt('HIGIVARO  •  Qualidade  •  Variedade  •  Confiança', M, 288.5, { s: 7.5, b: true, c: AZUL });
    txt('WhatsApp ' + (c.phone || '') + '   •   higivarooficial.github.io', M, 292.5, { s: 7, c: CINZA });
    txt(`Página ${p} de ${n}`, 210 - M, 290.5, { s: 7.5, c: CINZA, a: 'right' });
  }
  pdf.save(`${ehVenda ? 'Venda' : 'Orcamento'}-${doc.number}-${String(doc.client_name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').slice(0, 30)}.pdf`);
}

rotear();
