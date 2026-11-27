// Função "nfe" (Supabase Edge Function), 27/11/2026: NF-e da HIGIVARO na SEFAZ-BA com o certificado A1 guardado no cofre.
// Segredos cadastrados pelo dono no Supabase (nunca no código): NFE_PFX_B64 (arquivo .pfx em base64) e NFE_PFX_SENHA.
// Segurança: só atende usuários logados, liberados e com a permissão "Emitir NF-e" (ou administrador);
// nunca devolve o certificado nem a senha; só assina documentos do CNPJ da HIGIVARO.
import { createClient } from "jsr:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import { SECTIGO_OV_R36, ICP_BRASIL_RAIZ_V10 } from "./cadeia.ts";

const CNPJ = "69959700000104";
const cors = {
  "Access-Control-Allow-Origin": "https://higivarooficial.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
const adm = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------- certificado (lido do cofre uma vez por instância) ----------
type Cert = { certPem: string; keyPem: string; certB64: string; chave: CryptoKey; titular: string; validade: string; cliente: Deno.HttpClient };
let CERT: Cert | null = null;
async function certificado(): Promise<Cert> {
  if (CERT) return CERT;
  const b64 = Deno.env.get("NFE_PFX_B64"), senha = Deno.env.get("NFE_PFX_SENHA");
  if (!b64 || !senha) throw new Error("o certificado ainda não foi cadastrado no cofre (segredos NFE_PFX_B64 e NFE_PFX_SENHA)");
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(b64.replace(/\s+/g, ""))), false, senha); }
  catch { throw new Error("não consegui abrir o certificado: confira o arquivo e a senha cadastrados no cofre"); }
  const O = forge.pki.oids;
  const chaves = [...(p12.getBags({ bagType: O.pkcs8ShroudedKeyBag })[O.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: O.keyBag })[O.keyBag] || [])];
  const certs = (p12.getBags({ bagType: O.certBag })[O.certBag] || []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  const cn = (c: forge.pki.Certificate) => String(c.subject.getField("CN")?.value || "");
  const cert = certs.find((c) => cn(c).includes(CNPJ));
  const key = chaves[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!cert) throw new Error("o certificado do cofre não é da HIGIVARO (CNPJ " + CNPJ + ")");
  if (!key) throw new Error("o arquivo do cofre não tem a chave privada");
  if (cert.validity.notAfter < new Date()) throw new Error("o certificado do cofre está vencido");
  const pkcs8Der = forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))).getBytes();
  const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
  const certPem = forge.pki.certificateToPem(cert);
  const certB64 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const bytes = Uint8Array.from(pkcs8Der, (c) => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" }, false, ["sign"]);
  // deno-lint-ignore no-explicit-any
  const cliente = (Deno as any).createHttpClient({ cert: certPem, key: keyPem, certChain: certPem, privateKey: keyPem, caCerts: [SECTIGO_OV_R36, ICP_BRASIL_RAIZ_V10], http2: false, http1: true });
  CERT = { certPem, keyPem, certB64, chave, titular: cn(cert), validade: cert.validity.notAfter.toISOString().slice(0, 10), cliente };
  return CERT;
}

// ---------- SEFAZ-BA (SOAP 1.2) ----------
const url = (amb: string, servico: string) => `https://${amb === "1" ? "nfe" : "hnfe"}.sefaz.ba.gov.br/webservices/${servico}/${servico}.asmx`;
async function soap(amb: string, servico: string, conteudo: string) {
  const c = await certificado();
  const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${conteudo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  let r: Response;
  try {
    // deno-lint-ignore no-explicit-any
    r = await fetch(url(amb, servico), { method: "POST", headers: { "Content-Type": "application/soap+xml; charset=utf-8" }, body: env, client: c.cliente } as any);
  } catch (e) { throw new Error("sem conexão com a SEFAZ-BA: " + String((e as Error).message || e).slice(0, 200)); }
  const txt = await r.text();
  if (!r.ok) throw new Error(`SEFAZ-BA respondeu ${r.status}: ${txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)}`);
  return txt;
}
const tag = (xml: string, nome: string) => (xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`)) || [])[1] || "";
const todas = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, "g"))].map((m) => m[1]);

async function statusSefaz(amb: string) {
  const r = await soap(amb, "NFeStatusServico4", `<consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>${amb}</tpAmb><cUF>29</cUF><xServ>STATUS</xServ></consStatServ>`);
  return { cStat: tag(r, "cStat"), xMotivo: tag(r, "xMotivo") };
}
// Consulta cadastro de contribuinte na SEFAZ-BA (IE, endereço, situação). Só leitura, ambiente de produção.
async function cadastro(cnpj: string) {
  cnpj = cnpj.replace(/\D/g, ""); if (cnpj.length !== 14) throw new Error("CNPJ precisa ter 14 números");
  const r = await soap("1", "CadConsultaCadastro4", `<ConsCad versao="2.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infCons><xServ>CONS-CAD</xServ><UF>BA</UF><CNPJ>${cnpj}</CNPJ></infCons></ConsCad>`);
  return { cStat: tag(r, "cStat"), xMotivo: tag(r, "xMotivo"), cadastros: todas(r, "infCad").map((c) => ({ IE: tag(c, "IE"), nome: tag(c, "xNome"), fantasia: tag(c, "xFant"), situacao: tag(c, "cSit"), regime: tag(c, "xRegApur"), cnae: tag(c, "CNAE"),
    logradouro: tag(c, "xLgr"), numero: tag(c, "nro"), complemento: tag(c, "xCpl"), bairro: tag(c, "xBairro"), cMun: tag(c, "cMun"), municipio: tag(c, "xMun"), cep: tag(c, "CEP") })) };
}

// ---------- quem está pedindo ----------
async function usuario(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const a = adm();
  const { data: { user } } = await a.auth.getUser(token);
  if (!user) return null;
  const { data: p } = await a.from("profiles").select("id,full_name,role,active,access_status,permissions").eq("id", user.id).maybeSingle();
  if (!p || !p.active || p.access_status !== "liberado") return null;
  const pode = p.role === "admin" || (Array.isArray(p.permissions) && p.permissions.includes("emitir_nfe"));
  return pode ? p : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const quem = await usuario(req);
    if (!quem) return resp({ ok: false, erro: "sem permissão para NF-e (entre no sistema com um usuário que tenha \"Emitir NF-e\")" }, 403);
    const p = await req.json().catch(() => ({}));
    const amb = p.amb === "1" ? "1" : "2";
    if (p.acao === "certificado") { const c = await certificado(); return resp({ ok: true, titular: c.titular, validade: c.validade }); }
    if (p.acao === "status") return resp({ ok: true, ...(await statusSefaz(amb)) });
    if (p.acao === "cadastro") return resp({ ok: true, ...(await cadastro(String(p.cnpj || CNPJ))) });
    return resp({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    return resp({ ok: false, erro: String((e as Error)?.message || e) }, 500);
  }
});
