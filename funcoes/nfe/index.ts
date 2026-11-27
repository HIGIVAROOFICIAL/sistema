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
// Abre o .pfx (base64 + senha) e confere se é o certificado da HIGIVARO, válido. Mensagens não expõem nada do certificado.
function abrirPfx(b64: string, senha: string) {
  const limpo = String(b64 || "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) throw new Error("o arquivo enviado não é um certificado .pfx válido");
  const der = forge.util.decode64(limpo);
  if (der.length < 1000 || der.charCodeAt(0) !== 0x30) throw new Error(`o arquivo não parece um certificado .pfx (${der.length} bytes)`);
  let asn;
  try { asn = forge.asn1.fromDer(der); } catch { throw new Error("o arquivo do certificado está incompleto ou corrompido"); }
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, senha); }
  catch (e) {
    const m = String((e as Error)?.message || e);
    if (/MAC could not be verified|Invalid password/i.test(m)) throw new Error("a senha não confere com o certificado. Confira maiúsculas, minúsculas e espaços.");
    if (/Unsupported OID|PBE|cipher|algorithm/i.test(m)) throw new Error("o certificado foi exportado com uma criptografia que o servidor não abre (AES256). Exporte de novo escolhendo a criptografia TripleDES-SHA1. Detalhe: " + m.slice(0, 120));
    throw new Error("não consegui abrir o certificado. Detalhe técnico: " + m.slice(0, 160));
  }
  return { p12, limpo };
}
// Lê do cofre do banco (Supabase Vault); se não houver, dos segredos da função (forma antiga).
async function lerCofre() {
  const { data } = await adm().rpc("nfe_ler_certificado");
  const r = Array.isArray(data) ? data[0] : data;
  if (r?.pfx && r?.senha) return { b64: r.pfx as string, senha: r.senha as string };
  const b64 = Deno.env.get("NFE_PFX_B64"), senha = Deno.env.get("NFE_PFX_SENHA");
  if (b64 && senha && b64.length > 1000) return { b64, senha };
  throw new Error("o certificado ainda não foi guardado no cofre. Use o botão \"Guardar certificado no cofre\" em Admin › NF-e.");
}
async function certificado(): Promise<Cert> {
  if (CERT) return CERT;
  const { b64, senha } = await lerCofre();
  const { p12 } = abrirPfx(b64, senha);
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
  } catch (e) { throw new Error("sem conexão com a SEFAZ-BA: " + String((e as Error).message || e).slice(0, 700)); }
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
    // Guardar (ou trocar) o certificado no cofre: só administrador; abre e confere antes de gravar.
    if (p.acao === "guardar") {
      if (quem.role !== "admin") return resp({ ok: false, erro: "só o administrador pode guardar o certificado" }, 403);
      const senha = String(p.senha || ""); if (!senha) throw new Error("informe a senha do certificado");
      const { limpo, p12 } = abrirPfx(String(p.pfx || ""), senha);
      // Confere ANTES de gravar: tem de ser da HIGIVARO, com chave privada e dentro da validade.
      const O = forge.pki.oids;
      const certsNovo = (p12.getBags({ bagType: O.certBag })[O.certBag] || []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
      const daEmpresa = certsNovo.find((c) => String(c.subject.getField("CN")?.value || "").includes(CNPJ));
      if (!daEmpresa) throw new Error("este certificado não é da HIGIVARO (CNPJ 69.959.700/0001-04). Nada foi gravado.");
      if (daEmpresa.validity.notAfter < new Date()) throw new Error("este certificado está vencido. Nada foi gravado.");
      const temChave = (p12.getBags({ bagType: O.pkcs8ShroudedKeyBag })[O.pkcs8ShroudedKeyBag] || []).length + (p12.getBags({ bagType: O.keyBag })[O.keyBag] || []).length;
      if (!temChave) throw new Error("o arquivo não tem a chave privada (exporte marcando \"Sim, exportar a chave privada\"). Nada foi gravado.");
      const antes = CERT; CERT = null;
      await (async () => { const { error } = await adm().rpc("nfe_guardar_certificado", { p_pfx: limpo, p_senha: senha }); if (error) throw new Error("não consegui gravar no cofre: " + error.message); })();
      try { const c = await certificado(); return resp({ ok: true, titular: c.titular, validade: c.validade }); }
      catch (e) { CERT = antes; throw e; }
    }
    if (p.acao === "status") return resp({ ok: true, ...(await statusSefaz(amb)) });
    if (p.acao === "cadastro") return resp({ ok: true, ...(await cadastro(String(p.cnpj || CNPJ))) });
    return resp({ ok: false, erro: "ação desconhecida" }, 400);
  } catch (e) {
    return resp({ ok: false, erro: String((e as Error)?.message || e) }, 500);
  }
});
