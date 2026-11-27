// Função "boas-vindas" (Supabase Edge Function), 27/11/2026.
// Envia, UMA única vez, o e-mail de boas-vindas para um usuário recém-criado (pelo administrador ou que pediu acesso).
// Envio pelo Gmail da HIGIVARO (porta 465). Segredos configurados pelo dono no Supabase: GMAIL_USER e GMAIL_APP_PASSWORD.
// Proteções: só cadastros com menos de 2 horas e que ainda não receberam; quem pediu acesso também gera aviso para a empresa.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://higivarooficial.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const SITE = "https://higivarooficial.github.io/sistema/";

function modelo(titulo: string, corpo: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #dfe7f0">
    <div style="background:#032344;padding:20px 24px;color:#fff"><div style="font-size:22px;font-weight:800">HIGI<span style="color:#6cc531">VARO</span></div>
      <div style="font-size:12px;color:#b9cde4">Distribuidora de produtos de limpeza</div></div>
    <div style="height:4px;background:#6cc531"></div>
    <div style="padding:24px;color:#0d2a4a;font-size:15px;line-height:1.55"><h2 style="margin:0 0 12px;font-size:20px">${titulo}</h2>${corpo}</div>
    <div style="padding:14px 24px;background:#f4f7fb;color:#60728a;font-size:12px">HIGIVARO • Qualidade • Variedade • Confiança</div>
  </div></div>`;
}

// Aviso ao dono a cada NF-e emitida ou cancelada (chamado pelo gatilho do banco). Lê a nota no próprio banco
// (não confia no que vem no pedido) e manda uma única vez por evento.
const brl = (v: unknown) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (d: unknown) => d ? new Date(String(d)).toLocaleString("pt-BR", { timeZone: "America/Bahia" }) : "";
async function avisoNfe(id: string, evento: string) {
  const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: n } = await adm.from("nfe").select("*").eq("id", id).maybeSingle();
  if (!n) return resp({ ok: false, motivo: "nota não encontrada" }, 404);
  const cancel = evento === "cancelada";
  if (cancel ? (n.status !== "cancelada" || n.aviso_cancelada_em) : (n.status !== "autorizada" || n.aviso_emitida_em)) return resp({ ok: true, motivo: "nada a avisar" });
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return resp({ ok: false, motivo: "e-mail não configurado" }, 503);
  const { data: admins } = await adm.from("profiles").select("email").eq("role", "admin").eq("active", true);
  const para = [...new Set([user, ...(admins || []).map((a) => a.email).filter(Boolean)])];
  const teste = n.ambiente !== "1" ? " [TESTE - sem valor fiscal]" : "";
  const linha = (r: string, v: unknown) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#60728a">${r}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : "";
  const tabela = `<table style="font-size:14px;border-collapse:collapse">${linha("NF-e", `nº ${n.numero ?? ""} · série ${n.serie ?? ""}`)}${linha("Cliente", `${n.cliente || ""}${n.cliente_doc ? " · " + n.cliente_doc : ""}`)}${linha("Valor", brl(n.valor))}
    ${linha("Emitida por", n.emitida_por)}${linha("Emitida em", quando(n.emitida_em))}${linha("Protocolo", n.protocolo)}${linha("Chave", n.chave)}
    ${cancel ? linha("Cancelada por", n.cancelada_por) + linha("Cancelada em", quando(n.cancelada_em)) + linha("Motivo", n.motivo_cancelamento) + linha("Protocolo do cancelamento", n.protocolo_cancelamento) : ""}</table>`;
  const alerta = `<p style="margin-top:16px;padding:10px 12px;background:#fff8e6;border:1px solid #f3dca3;border-radius:8px;color:#7a5a00;font-size:13px">Não reconhece esta ${cancel ? "operação" : "nota"}? Entre no sistema (Notas fiscais › NF-e emitidas)${cancel ? "" : ", cancele a nota (em até 24 horas)"} e troque as senhas dos usuários.</p>`;
  const smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } } });
  await smtp.send({ from: `Sistema HIGIVARO <${user}>`, to: para, subject: `${cancel ? "❌ NF-e CANCELADA" : "🧾 NF-e emitida"} nº ${n.numero ?? ""} · ${n.cliente || ""} · ${brl(n.valor)}${teste}`,
    html: modelo(`${cancel ? "NF-e cancelada" : "NF-e emitida"}${teste}`, `<p>${cancel ? "Uma NF-e da HIGIVARO foi <b>cancelada</b> no sistema." : "Uma NF-e da HIGIVARO foi <b>emitida</b> no sistema."}</p>${tabela}${alerta}<p style="margin-top:16px"><a href="${SITE}" style="color:#2f86de">Abrir o sistema</a></p>`), content: "auto" });
  await smtp.close();
  await adm.from("nfe").update(cancel ? { aviso_cancelada_em: new Date().toISOString() } : { aviso_emitida_em: new Date().toISOString() }).eq("id", n.id);
  return resp({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const pedido = await req.json();
    if (pedido.tipo === "nfe") return await avisoNfe(String(pedido.id || ""), String(pedido.evento || ""));
    const { user_id } = pedido;
    if (!user_id) return resp({ ok: false, motivo: "faltou o usuário" }, 400);
    const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: p, error: erroPerfil } = await adm.from("profiles").select("id,full_name,email,login_number,access_status,welcome_sent_at,created_at").eq("id", user_id).maybeSingle();
    if (erroPerfil) { console.error("perfil:", erroPerfil); return resp({ ok: false, motivo: "erro ao ler o usuário: " + erroPerfil.message }, 500); }
    if (!p) return resp({ ok: false, motivo: "usuário não encontrado (" + user_id + ")" }, 404);
    if (p.welcome_sent_at) return resp({ ok: true, motivo: "já enviado antes" });
    if (Date.now() - new Date(p.created_at).getTime() > 2 * 3600e3) return resp({ ok: false, motivo: "cadastro antigo" }, 400);
    const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!user || !pass) return resp({ ok: false, motivo: "envio de e-mail ainda não configurado no Supabase" }, 503);

    const nome = esc((p.full_name || "").split(" ")[0] || "");
    const liberado = p.access_status === "liberado";
    const acesso = p.login_number ? `<b>Nº do usuário: ${p.login_number}</b> (ou o seu e-mail ${esc(p.email)})` : `o seu e-mail <b>${esc(p.email)}</b>`;
    const corpo = liberado
      ? `<p>Olá, ${nome}! Seu acesso ao <b>Sistema HIGIVARO</b> foi criado.</p>
         <p>Para entrar, acesse <a href="${SITE}" style="color:#2f86de">${SITE}</a> e use ${acesso} com a <b>senha temporária</b> que o administrador passou para você.</p>
         <p>No primeiro acesso o sistema vai pedir para você <b>criar a sua senha pessoal</b>. Só você vai saber essa senha.</p>
         <p style="margin-top:20px"><a href="${SITE}" style="background:#6cc531;color:#082a00;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700">Entrar no sistema</a></p>`
      : `<p>Olá, ${nome}! Recebemos o seu pedido de acesso ao <b>Sistema HIGIVARO</b>.</p>
         <p>O administrador vai analisar e liberar o seu acesso. Assim que for liberado, é só entrar em <a href="${SITE}" style="color:#2f86de">${SITE}</a> com ${acesso} e a senha que você criou.</p>`;

    const smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } } });
    await smtp.send({ from: `HIGIVARO <${user}>`, to: p.email, subject: liberado ? "Bem-vindo(a) ao Sistema HIGIVARO" : "Recebemos seu pedido de acesso - Sistema HIGIVARO", html: modelo(liberado ? "Bem-vindo(a)!" : "Pedido de acesso recebido", corpo), content: "auto" });
    if (!liberado) {
      await smtp.send({ from: `Sistema HIGIVARO <${user}>`, to: user, subject: `Novo pedido de acesso: ${p.full_name || p.email}`,
        html: modelo("Novo pedido de acesso", `<p><b>${esc(p.full_name)}</b> (${esc(p.email)}) pediu acesso ao sistema.</p><p>Para liberar: Admin › Usuários e acessos, em <a href="${SITE}">${SITE}</a>.</p>`), content: "auto" });
    }
    await smtp.close();
    await adm.from("profiles").update({ welcome_sent_at: new Date().toISOString() }).eq("id", p.id);
    return resp({ ok: true });
  } catch (e) {
    return resp({ ok: false, motivo: String((e as Error)?.message || e) }, 500);
  }
});
