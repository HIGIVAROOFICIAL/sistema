// Função "nfe" (Supabase Edge Function), 27/11/2026: NF-e da HIGIVARO na SEFAZ-BA com o certificado A1 guardado no cofre.
// Segredos cadastrados pelo dono no Supabase (nunca no código): NFE_PFX_B64 (arquivo .pfx em base64) e NFE_PFX_SENHA.
// Segurança: só atende usuários logados, liberados e com a permissão "Emitir NF-e" (ou administrador);
// nunca devolve o certificado nem a senha; só assina documentos do CNPJ da HIGIVARO.
import { createClient } from "jsr:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
// Certificados públicos que o servidor precisa para confiar nos sites da SEFAZ-BA (os servidores não mandam a cadeia completa).
// Produção (nfe.sefaz.ba.gov.br): intermediário Sectigo Public Server Authentication CA OV R36.
// Homologação (hnfe.sefaz.ba.gov.br): raiz ICP-Brasil "Autoridade Certificadora Raiz Brasileira v10" (ITI).
const SECTIGO_OV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----
`;
const ICP_BRASIL_RAIZ_V10 = `-----BEGIN CERTIFICATE-----
MIIGrDCCBJSgAwIBAgIJANLVi0S/gZNCMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD
VQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv
IE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG
A1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2
MTAwHhcNMTkwNzAxMTkxNTU5WhcNMzIwNzAxMTIwMDU5WjCBmDELMAkGA1UEBhMC
QlIxEzARBgNVBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNp
b25hbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNTAzBgNVBAMM
LEF1dG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEwMIIC
IjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAk3AxKl1ZtP0pNyjChqO7qNkn
+/sClZeqiV/Kd7KnnbkDbI2y3VWcUG7feCE/deIxot6GH6JXncRG794UZl+4doD0
D0/cEwBd4DvrDSZm0RT40xhmYYOTxZDJxv+coTHdmsT5aNmSkktfjzYX4HQHh/7M
em+kTOpT/3E4K6B7KVs9HkOT7nXx5yU1qYbVWqI0qpJM9mOTSFx8C9HiKcHvLCvt
1ioXKPAmFuHPkayOcXP2MXeb+VRNjWKU4E+L2t5uZPKVx1M/9i1DztlLb4K8OfYg
GaPDUSF1sxnoGk5qZHLleO6KjCpmuQepmgsBvxi2YNO7X2YUwQQx1AXNSolgtkAR
5gt+1WzxhbFUhItQqlhqxgWHefLmiT5T/Ctz/P2v+zSO4efkkIzsi1iwD+ypZvM2
lnIvB24RcSN6jzmCahLPX4CwjwIK6JsSoMVxIhpZHCguUP4LXqP8IWUZ6WgS/4zB
7B9E0EICl2rM1PRy+6ulv+ZOW256e8a0pijUB+hXM1msUq9L92476FAAX8va3sP7
+Uut94+bGHmubcTLImWUPrxNT7QyrvE3FyHicfiHioeFL2oV4cXTLZrEq2wS8R4P
KPdSzNn5Z9e2uMEGYQaSNO+OwvVycpIhOBOqrm12wJ9ZhWKtM5UOo34/o37r5ZBI
TYXAGbhqQDB9mWXwH+0CAwEAAaOB9jCB8zBOBgNVHSAERzBFMEMGBWBMAQEAMDow
OAYIKwYBBQUHAgEWLGh0dHA6Ly9hY3JhaXouaWNwYnJhc2lsLmdvdi5ici9EUENh
Y3JhaXoucGRmMEAGA1UdHwQ5MDcwNaAzoDGGL2h0dHA6Ly9hY3JhaXouaWNwYnJh
c2lsLmdvdi5ici9MQ1JhY3JhaXp2MTAuY3JsMB8GA1UdIwQYMBaAFHTzfv/8n1N6
8Xzrqz6kptoYukVjMB0GA1UdDgQWBBR0837//J9TevF866s+pKbaGLpFYzAPBgNV
HRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQ0FAAOCAgEA
eCNhBSuy/Ih/T+1VOtAJju85SrtoE3vET1qXASpmjQllDHG/ph7VFNRAkC+gha+B
CbjoA5oJ/8wwl+Qdp1KGz6nXXFTLx3osU+kjm0srmBf9nyXHPqvFyvBeB0A7sYb7
TmII9GKD20oCxsdkccR/oE/JuTaNnGq0GYZ2aDb5v62uLi21Y6P9UBiTxZqQ4ojW
ET6kXNjlK238jpXv17FR8Sg3VusCvX7Q8eJkavvHHZDeWck2fSA+ycAc2JeL2Z0B
MSxGWpH32WM9J8+6XqCJUXHiWEV0zCE8wDYiYC+047pTxQI/gB/FcU7jvylh98DJ
kQPHd/Tp6Og3ynlDA9n9uBbxYHVRZs9vsZ/7xTFaxRe+zk8dhgKgZ/3RrcMFB570
2t8LFbyuUE/kQVY6rZ0QJ9qMWQ7VPLRwRhiMeU3k8WDJb/tBbOXHBqldTbWyQ+mp
MEDWhbrzE/IED82wAuO23Tb05cYk2xC7+Izef8fSc3XdJDuPSbcDpWukzyCDtSEH
isLiGEtIbYRiPsF3czlQPsnIEVoTTCWxHCH1zYR6zScSv18Qh69qVe2J40K5jZoP
GEOhq/oKhVJQAdvAFW5Odp7mF3Tk9nivjjsctJSxY26LFiV5GRV+07SSse4ti0aO
jO5PLg5SWjfcOtBG2rz02EIvQAmLcb0kGBtfdj0lW/w=
-----END CERTIFICATE-----
`;


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
