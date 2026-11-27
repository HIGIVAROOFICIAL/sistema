-- 27/11/2026: 2ª leva de NCM (itens específicos: piscina, lavanderia industrial, automotivo, pet, diversos).
-- Códigos existentes (validados na SEFAZ-BA), mas a classificação destes itens deve ser REVISADA pelo contador.
with p as (
  select id, code, translate(upper(regexp_replace(description, '\s+', ' ', 'g')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') d
  from public.products where coalesce(ncm, '') = ''
), r as (
  select id, code, d, case
    when d ~ '^(ALGICIDA|AQUASHOCK|CLORO GRANULADO|CLORO TABLETE|STARTCLOR)' then '38089419'
    when d ~ '^(CLARIFICANTE|GEL CLARIFICANTE|ACIDULANTE|DECAP|CARRETILHA (DECAP|PASSIVANT)|SEC |TRATAMENTO HIDRO)' then '38249989'
    when d ~ '^SULFATO DE ALUMINIO' then '28332200'
    when d ~ '^BARRILHA' then '28362010'
    when d ~ '^ELEVADOR DE ALCALINIDADE' then '28363000'
    when d ~ '^REDUTOR DE PH' then '28331900'
    when d ~ '^(ESTOJO DE TESTE|SOLUCAO [0-9] PARA ANALISE|FITA TESTE)' then '38221990'
    when d ~ '^(ADITIVO DESENGRAXANTE|CARRETILHA DESENGRAXE|GEL 1 KG PINHO)' then '34025000'
    when d ~ '^(CARRETILHA LUBRI|LUBRI F|DESENGRIPANTE)' then '34031900'
    when d ~ '^(OLEO DE SILICONE|SILICONE GEL)' then '39100090'
    when d ~ '^PROTETIVO PARA RADIADORES' then '38200000'
    when d ~ '^REMOVEDOR DE PICHE' then '38140090'
    when d ~ '^QUEROSENE' then '27101919'
    when d ~ '^(CONDICIONADOR|AGUA OXIGENADA CREMOSA)' then '33059000'
    when d ~ '^(XAMPU|SHAMPOO)' then '33051000'
    when d ~ '^AGUA DESMINERALIZADA' then '28539090'
    when d ~ '^ALVEJANTE (LAVANDA|P/ ROUPAS)' then '28289011'
    when d ~ '^BUCHA' then '14049090'
    when d ~ '^CABO DE MADEIRA' then '44170090'
    when d ~ '^CAMISETA' then '61051000'
    when d ~ '^DESENTUPIDOR' then '28151200'
    when d ~ '^DISCO' then '68053010'
    when d ~ '^(EVITA MOFO|PEDRA EVITA MOFO)' then '28272090'
    when d ~ '^INSETICIDA' then '38089199'
    when d ~ '^KIT URNA' then '49119900'
    when d ~ '^MASCARA' then '63079010'
    when d ~ '^NAFTALINA' then '29029020'
    when d ~ '^OLEO DE (CITRONELA|EUCALIPTO)' then '33012990'
    when d ~ '^OSSO' then '40169990'
    when d ~ '^PASTA DESENGRAXANTE' then '34012090'
    when d ~ '^PORTA GUARDANAPO' then '39249000'
    when d ~ '^SUPORTE DE METAL' then '73239900'
    when d ~ '^(SUPORTE PARA LT|RASTELO)' then '39269090'
  end ncm
  from p
), u as (
  update public.products x set ncm = r.ncm, updated_at = now() from r where x.id = r.id and r.ncm is not null returning x.code, x.ncm
)
select (select count(*) from u) preenchidos,
  (select string_agg(code || '=' || ncm, ',') from u) revisar,
  (select string_agg(code || ' ' || d, ' ; ') from r where ncm is null) sem_ncm;
