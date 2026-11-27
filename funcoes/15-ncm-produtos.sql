-- 27/11/2026: NCM dos produtos por categoria (só preenche quem está sem NCM). Todos os códigos foram validados na SEFAZ-BA (homologação).
-- Classificação sugerida para produtos de limpeza; o contador pode revisar. Itens sem regra clara ficam sem NCM (lista no fim).
with p as (
  select id, translate(upper(regexp_replace(description, '\s+', ' ', 'g')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') d
  from public.products where coalesce(ncm, '') = ''
), r as (
  select id, case
    when d ~ '^PAPEL HIGIENICO' then '48181000'
    when d ~ '^PAPEL (TOALHA|BRANCO|CELULOSE)' then '48182000'
    when d ~ '^GUARDANAPO' then '48183000'
    when d ~ '^SACO' then '39232190'
    when d ~ 'HIPOCLORITO DE CALCIO' then '28281000'
    when d ~ '^(AGUA SANITAR|HIPOCLORITO DE SODIO|CLORO [0-9]|CLORO ATIVO|CLORO GEL|KIT CLORO|ALVEJANTE CLORADO)' then '28289011'
    when d ~ '^(AMACIANTE|AMACCIANTE|BASE PERFUMADA PARA AMACIANTE|KIT AMACIANTE|FACILITADOR|SEM PASSAR)' then '38099190'
    when d ~ '^(DESINFETANTE|DESIFETANTE|BACTERICIDA|DILUIVEL|LAT BG|IODO|ACIDO PERACETICO|LIMPA LOUCAS SANITARIAS DESINFETANTE|SPRAY (ANTISSEPTICO )?CLOREXIDINA)' then '38089419'
    when d ~ '^(ALCOOL|GEL ANTISSEPTICO)' then '22089000'
    when d ~ '^SABONETE' and d ~ '(BARRA|[0-9] ?(G|GR)( |$))' and d !~ '[0-9] ?KG' then '34011190'
    when d ~ '^SABONETE' then '34013000'
    when d ~ '^(SABAO (EM )?(BARRA|PEDACOS)|SABAO GLICERINADO)' then '34011900'
    when d ~ '^SABAO EM PASTA' then '34012090'
    when d ~ '^SABAO (EM PO|LIQUIDO|QUEROSENE)' then '34025000'
    when d ~ '^(PEDRA SANITARIA|BLOCO SANITARIO|GEL ADESIVO|PASTILHA ADESIVA|DESORIZADOR|ODORIZADOR|ODORIZANTE|NEUTRALIZADOR|DIFUSOR|AGUA PERFUMADA|AROMATIZANTE|AROAMTIZANTE|CAR FRAGRANCE|FOLHA AROMATIZANTE)' then '33074900'
    when d ~ '^VELA' then '34060000'
    when d ~ '^(SAPONACEO|CIF LIMPEZA MILAGROSA)' then '34054000'
    when d ~ '^(LUSTRA MOVEIS|OLEO DE PEROBA|CERA LIQUIDA|JET CERA|CERA LIMPADORA|ACABAMENTO ACRILICO|SELADOR)' then '34052000'
    when d ~ '^(CERA AUTO|CERA AUTOMOTIVA|CERA CREMOSA|CERA SOLIDA)' then '34053000'
    when d ~ '^(BRILHA INOX|BRILHA PNEU|PRETITA|RENOVADOR DE PLASTICOS|RESTAURADOR DE PLASTICOS|REVITALIZADOR DE PLASTICOS|COURO LIMPA)' then '34059000'
    when d ~ '^VASSOUR(A|AO)' and d ~ '(PIACAVA|COQUEIRO|PITA)' then '96031000'
    when d ~ '^(VASSOURA|VASSOURAO|RODO|REFIL DE RODO|ESCOVA|PASSADOR DE CERA)' then '96039000'
    when d ~ '^(FLANELA|PANO|KIT PANO)' then '63071000'
    when d ~ '^(LA DE ACO|ESPONJA MULTIUSO ESPIRAL METALICO)' then '73231000'
    when d ~ '^ESPONJA' then '39211390'
    when d ~ '^FIBRA' then '68053090'
    when d ~ '^(DISPENSER|PA PLASTICA|PA DE LIXO PLASTICA)' then '39249000'
    when d ~ '^PA DE LIXO GALVANIZADA' then '73239900'
    when d ~ '^CABO DE ALUMINIO' then '76169900'
    when d ~ '^SODA ESCAMA' then '28151100'
    when d ~ '^REMOVEDOR (A BASE DE ACETONA|DE ESMALTE)' then '33043000'
    when d ~ '^COLONIA' then '33030020'
    when d ~ '^(LIMPADOR|LIMPASOR|LIMPA |LIMPA-|MULTIUSO|DETERGENTE|LAVA|DESENGORDURANTE|ALCALINO|STARTGRILL|STARTEC|TIRA (LIMO|MANCHAS|FERRUGEM|RISCO)|TARIA MANCHAS|REMOVEDOR DE CERAS|SOLUCAO ACIDA|ALVEJANTE SEM CLORO|ALVEJANTE PEROXIDO|CIF |FLOTADOR|SHAMPOO LAVA AUTOS|KIT (BANHEIRO|COZINHA|LIMPADOR|MULTIUSO|3 UND))' then '34025000'
  end ncm
  from p
), u as (
  update public.products x set ncm = r.ncm, updated_at = now() from r where x.id = r.id and r.ncm is not null returning x.ncm
)
select (select count(*) from u) preenchidos,
  (select string_agg(n || ':' || c, ' | ' order by c desc) from (select ncm n, count(*) c from u group by 1) t) por_ncm;
