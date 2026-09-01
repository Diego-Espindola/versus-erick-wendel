#!/bin/bash
# Zera o lote, roda a rodada e mostra o que a API respondeu.
#
#   ./k6/rodar.sh erick tudo     → O JULGAMENTO: contrato → 100 → 1.000 → 10.000
#                                   com quadro final consolidado.
#
#   ./k6/rodar.sh erick 1        → rodada 1 (100) no sistema do Erick
#   ./k6/rodar.sh juniors 4      → rodada 4 (10.000) no dos júniors
#   ./k6/rodar.sh erick 3        → contrato (sem a prova da expiração)
#   ./k6/rodar.sh erick 3exp     → contrato + prova da expiração (leva 5 min)
#   ./k6/rodar.sh erick cliques  → teste dos 2 cliques
#
#   ./k6/rodar.sh erick placar   → só mostra o placar, sem zerar nem testar
#   ./k6/rodar.sh erick reset    → só zera o lote
#
# No modo 'tudo' ele PARA entre as etapas esperando ENTER — o ritmo é seu.
# Pra rodar direto, sem pausa:           AUTO=1 ./k6/rodar.sh erick tudo
# Pra ver a saída crua do k6:            VERBOSO=1 ./k6/rodar.sh erick 2
#
# Zerar usa POST /batch/reset. Se o endpoint não responder 200, cai pra reiniciar
# o container — mais lento, e não limpa banco com volume.

set -e
cd "$(dirname "$0")/.."

ALVO=${1:-erick}
RODADA=${2:-1}

VERMELHO='\033[1;31m'
VERDE='\033[1;32m'
AMARELO='\033[1;33m'
CINZA='\033[0;90m'
NEGRITO='\033[1m'
FIM='\033[0m'

case $ALVO in
  erick)   PORTA=7811 ;;
  juniors) PORTA=7812 ;;
  *) echo "alvo inválido: use 'erick' ou 'juniors'"; exit 1 ;;
esac

BASE="http://localhost:$PORTA"
TRABALHO=$(mktemp -d)
trap 'rm -rf "$TRABALHO"' EXIT

# Linhas do quadro final, uma por etapa. Preenchido por rodar_contrato/rodar_carga.
RESUMO=()

# ────────────────────────────────────────────────────────────────────────────
# Infraestrutura: subir, zerar, ler o placar
# ────────────────────────────────────────────────────────────────────────────

esperar_subir() {
  echo -n ">> esperando subir"
  for i in $(seq 1 40); do
    # Qualquer resposta HTTP serve, inclusive 404: aqui só interessa saber se o
    # processo já está atendendo. Sistema em construção pode não ter /batch ainda.
    if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
      # Folga: responder na porta não quer dizer que o estado interno já foi
      # reinicializado. Sem isso a rodada seguinte pega o lote pela metade.
      sleep 2
      echo " ok"
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo -e " ${VERMELHO}NÃO SUBIU${FIM}"
  exit 1
}

zerar() {
  local codigo
  codigo=$(curl -s -o /dev/null -w "%{http_code}" -X POST --max-time 5 "$BASE/batch/reset" 2>/dev/null || echo "000")

  if [ "$codigo" = "200" ]; then
    echo -e "${CINZA}>> lote zerado via POST /batch/reset${FIM}"
    return 0
  fi

  echo -e "${AMARELO}>> /batch/reset respondeu $codigo — reiniciando o container${FIM}"
  docker compose restart "$ALVO" > /dev/null
  esperar_subir
}

# Lê o GET /batch e preenche P_SOLD / P_RESERVED / P_AVAILABLE / P_TOTAL.
# P_EXISTE=0 quando o endpoint não respondeu JSON — sistema sem placar próprio.
ler_placar() {
  local json
  json=$(curl -s --max-time 5 "$BASE/batch" 2>/dev/null || echo '')

  if [ -z "$json" ] || ! echo "$json" | jq -e . > /dev/null 2>&1; then
    P_EXISTE=0
    P_RESPOSTA="${json:-<vazia>}"
    return
  fi

  P_EXISTE=1
  P_SOLD=$(echo "$json"      | jq -r '.sold      // 0')
  P_RESERVED=$(echo "$json"  | jq -r '.reserved  // 0')
  P_AVAILABLE=$(echo "$json" | jq -r '.available // 0')
  P_TOTAL=$(echo "$json"     | jq -r '.total     // 100')
}

# Imprime o bloco do placar e devolve 1 se o lote estiver furado.
mostrar_placar() {
  ler_placar

  echo -e "  ${NEGRITO}O QUE O PLACAR DIZ${FIM} ${CINZA}(GET /batch)${FIM}"

  if [ "$P_EXISTE" = "0" ]; then
    echo -e "    ${VERMELHO}não respondeu JSON válido${FIM} ${CINZA}— resposta: $P_RESPOSTA${FIM}"
    echo ""
    return 1
  fi

  printf "    VENDIDOS ......... %s\n" "$P_SOLD"
  printf "    RESERVADOS ....... %s\n" "$P_RESERVED"
  printf "    DISPONÍVEIS ...... %s\n" "$P_AVAILABLE"
  printf "    LOTE ............. %s\n" "$P_TOTAL"

  local ok=1 soma=$((P_SOLD + P_RESERVED + P_AVAILABLE))
  if [ "$P_SOLD" -gt "$P_TOTAL" ]; then
    echo -e "    ${VERMELHO}>>> ESTOUROU O LOTE: vendeu $P_SOLD de $P_TOTAL <<<${FIM}"
    ok=0
  elif [ "$((P_SOLD + P_RESERVED))" -gt "$P_TOTAL" ]; then
    # Na parte 2 o estouro aparece em reserved: o ingresso saiu do lote sem ter
    # sido vendido ainda. Vender depois é só uma questão de chamar o webhook.
    echo -e "    ${VERMELHO}>>> ESTOUROU O LOTE: comprometeu $((P_SOLD + P_RESERVED)) de $P_TOTAL <<<${FIM}"
    ok=0
  fi
  if [ "$P_AVAILABLE" -lt 0 ]; then
    echo -e "    ${VERMELHO}>>> DISPONÍVEIS NEGATIVO: $P_AVAILABLE <<<${FIM}"
    ok=0
  fi
  if [ "$soma" -ne "$P_TOTAL" ]; then
    echo -e "    ${VERMELHO}>>> A CONTA NÃO FECHA: $soma em vez de $P_TOTAL <<<${FIM}"
    ok=0
  fi
  [ "$ok" = "1" ] && echo -e "    ${VERDE}lote íntegro${FIM}"
  echo ""
  [ "$ok" = "1" ]
}

# ────────────────────────────────────────────────────────────────────────────
# Apresentação
# ────────────────────────────────────────────────────────────────────────────

cabecalho() {
  echo ""
  echo -e "${NEGRITO}  ══════════════════════════════════════════════════════════${FIM}"
  echo -e "${NEGRITO}   $1${FIM}   ${CINZA}[$ALVO]${FIM}"
  echo -e "${NEGRITO}  ══════════════════════════════════════════════════════════${FIM}"
  echo ""
}

pausar() {
  [ -n "$AUTO" ] && return 0
  echo ""
  echo -ne "${CINZA}  — ENTER pra próxima etapa —${FIM}"
  read -r < /dev/tty || true
  echo ""
}

# Lê uma métrica do summary-export do k6. Métrica zerada não aparece no JSON.
metrica() {
  jq -r "(.metrics.\"$2\".$3 // 0)" "$1" 2>/dev/null || echo 0
}

# ────────────────────────────────────────────────────────────────────────────
# Etapa: o contrato (rodada 3)
# ────────────────────────────────────────────────────────────────────────────

rodar_contrato() {
  local expiracao=$1 titulo="ETAPA 1 — O CONTRATO"
  [ -n "$expiracao" ] && titulo="ETAPA 1 — O CONTRATO + EXPIRAÇÃO"

  cabecalho "$titulo"
  zerar
  echo ""

  local saida="$TRABALHO/contrato.txt" resumo="$TRABALHO/contrato.json"
  k6 run --quiet --summary-export="$resumo" -e "URL=$BASE" ${expiracao:+-e EXPIRACAO=1} \
    k6/rodada-3-contrato.js > "$saida" 2>&1 || true

  # As linhas de check do contrato: "✓ 2.3 devolve o cpf enviado"
  echo -e "  ${NEGRITO}AS REGRAS DO CONTRATO${FIM}"
  local linhas
  linhas=$(grep -E '(✓|✗) [0-9]+\.[0-9]+ ' "$saida" | sed 's/^ *//' || true)
  while IFS= read -r linha; do
    [ -z "$linha" ] && continue
    case "$linha" in
      ✗*) echo -e "    ${VERMELHO}${linha}${FIM}" ;;
      *)  echo -e "    ${CINZA}${linha}${FIM}" ;;
    esac
  done <<< "$linhas"
  echo ""

  local passou falhou total
  passou=$(metrica "$resumo" checks passes)
  falhou=$(metrica "$resumo" checks fails)
  total=$((passou + falhou))

  echo -e "  ${NEGRITO}VEREDICTO${FIM}"
  if [ "$total" = "0" ]; then
    echo -e "    ${VERMELHO}✗ o contrato nem chegou a rodar${FIM}"
    RESUMO+=("CONTRATO|não rodou|0")
  elif [ "$falhou" = "0" ]; then
    echo -e "    ${VERDE}✓ CUMPRIU O CONTRATO INTEIRO — $passou de $total regras${FIM}"
    RESUMO+=("CONTRATO|$passou/$total regras cumpridas|1")
  else
    echo -e "    ${VERMELHO}✗ CUMPRIU $passou DE $total REGRAS — $falhou não passaram${FIM}"
    RESUMO+=("CONTRATO|$passou/$total regras cumpridas|0")
  fi
  echo ""
  echo -e "  ${CINZA}saída completa do k6: $saida${FIM}"
}

# ────────────────────────────────────────────────────────────────────────────
# Etapa: uma rodada de carga
#   $1 = script   $2 = título   $3 = rótulo do quadro final   $4 = nº de requisições
# ────────────────────────────────────────────────────────────────────────────

rodar_carga() {
  local script=$1 titulo=$2 rotulo=$3 enviadas=$4

  cabecalho "$titulo"
  zerar
  echo ""

  local arquivo="${enviadas}req"
  local saida="$TRABALHO/$arquivo.txt" resumo="$TRABALHO/$arquivo.json"
  if [ -n "$VERBOSO" ]; then
    k6 run --summary-export="$resumo" -e "URL=$BASE" "$script" 2>&1 | tee "$saida" || true
  else
    k6 run --quiet --summary-export="$resumo" -e "URL=$BASE" "$script" > "$saida" 2>&1 || true
  fi

  local v409 v422 v5xx voutros vendidas p95 rps
  vendidas=$(metrica "$resumo" resp_201 count)
  v409=$(metrica    "$resumo" resp_409 count)
  v422=$(metrica    "$resumo" resp_422 count)
  v5xx=$(metrica    "$resumo" resp_5xx count)
  voutros=$(metrica "$resumo" resp_outros count)
  p95=$(jq -r '(.metrics.http_req_duration."p(95)" // 0) | . * 100 | round / 100' "$resumo" 2>/dev/null || echo 0)
  rps=$(jq -r '(.metrics.http_reqs.rate // 0) | round' "$resumo" 2>/dev/null || echo 0)

  echo -e "  ${NEGRITO}O QUE A API RESPONDEU${FIM} ${CINZA}($enviadas requisições)${FIM}"
  printf  "    201 vendeu ....... %s\n" "$vendidas"
  printf  "    409 esgotado ..... %s\n" "$v409"
  [ "$v422" != "0" ]    && printf "    422 limite CPF ... %s\n" "$v422"           || true
  [ "$v5xx" != "0" ]    && echo -e "    ${VERMELHO}5xx quebrou ...... $v5xx${FIM}" || true
  [ "$voutros" != "0" ] && echo -e "    ${AMARELO}fora do contrato . $voutros${FIM}" || true
  echo ""

  local placar_ok=1
  mostrar_placar || placar_ok=0

  echo -e "  ${NEGRITO}DESEMPENHO${FIM}"
  echo -e "    p95 ${p95}ms   ·   ${rps} req/s"
  echo ""

  # O lote é de 100: em qualquer rodada de carga a API tem que dizer 201 exatamente
  # 100 vezes. Menos que isso é ingresso que sobrou sem motivo; mais é venda dupla.
  local ok=1 nota=""
  echo -e "  ${NEGRITO}VEREDICTO${FIM}"
  if [ "$vendidas" -gt 100 ]; then
    echo -e "    ${VERMELHO}✗ VENDEU $vendidas INGRESSOS — $((vendidas - 100)) A MAIS QUE O LOTE${FIM}"
    nota="vendeu $vendidas (+$((vendidas - 100)))"
    ok=0
  elif [ "$vendidas" -lt 100 ]; then
    echo -e "    ${VERMELHO}✗ VENDEU SÓ $vendidas DE 100 — sobrou ingresso sem comprador${FIM}"
    nota="vendeu só $vendidas de 100"
    ok=0
  else
    echo -e "    ${VERDE}✓ VENDEU EXATAMENTE 100${FIM}"
    nota="vendeu 100 em cheio"
  fi
  if [ "$v5xx" != "0" ]; then
    echo -e "    ${VERMELHO}✗ o servidor quebrou em $v5xx requisições${FIM}"
    nota="$nota · $v5xx erros 5xx"
    ok=0
  fi
  if [ "$voutros" != "0" ]; then
    echo -e "    ${AMARELO}✗ $voutros respostas fora do contrato${FIM}"
    ok=0
  fi
  if [ "$placar_ok" = "0" ]; then
    if [ "$P_EXISTE" = "0" ]; then
      echo -e "    ${VERMELHO}✗ não dá pra conferir: o sistema não tem GET /batch${FIM}"
      nota="$nota · sem GET /batch"
    else
      echo -e "    ${VERMELHO}✗ o placar do próprio sistema não bate${FIM}"
      nota="$nota · placar furado"
    fi
    ok=0
  fi

  RESUMO+=("$rotulo|$nota · p95 ${p95}ms · ${rps} req/s|$ok")
  echo ""
  echo -e "  ${CINZA}saída completa do k6: $saida${FIM}"
}

# ────────────────────────────────────────────────────────────────────────────
# Quadro final
# ────────────────────────────────────────────────────────────────────────────

quadro_final() {
  echo ""
  echo -e "${NEGRITO}  ══════════════════════════════════════════════════════════${FIM}"
  echo -e "${NEGRITO}   RESULTADO FINAL${FIM}   ${CINZA}[$ALVO]${FIM}"
  echo -e "${NEGRITO}  ══════════════════════════════════════════════════════════${FIM}"
  echo ""

  local passou=0 total=0
  for linha in "${RESUMO[@]}"; do
    IFS='|' read -r rotulo nota ok <<< "$linha"
    total=$((total + 1))
    if [ "$ok" = "1" ]; then
      passou=$((passou + 1))
      printf "   ${VERDE}✓${FIM}  %-14s ${CINZA}%s${FIM}\n" "$rotulo" "$nota"
    else
      printf "   ${VERMELHO}✗${FIM}  %-14s ${CINZA}%s${FIM}\n" "$rotulo" "$nota"
    fi
  done

  echo ""
  echo -e "  ${NEGRITO}  ──────────────────────────────────────────────────────${FIM}"
  if [ "$passou" = "$total" ]; then
    echo -e "   ${VERDE}${NEGRITO}PASSOU EM $passou DE $total ETAPAS${FIM}"
  else
    echo -e "   ${VERMELHO}${NEGRITO}PASSOU EM $passou DE $total ETAPAS${FIM}"
  fi
  echo ""
}

# ────────────────────────────────────────────────────────────────────────────
# Modos
# ────────────────────────────────────────────────────────────────────────────

case $RODADA in
  tudo|julgamento)
    rodar_contrato ""                                                    ; pausar
    rodar_carga k6/rodada-1-100.js   "ETAPA 2 — 100 REQUISIÇÕES"    "100 req"    100    ; pausar
    rodar_carga k6/rodada-2-1000.js  "ETAPA 3 — 1.000 REQUISIÇÕES"  "1.000 req"  1000   ; pausar
    rodar_carga k6/rodada-4-10000.js "ETAPA 4 — 10.000 REQUISIÇÕES" "10.000 req" 10000
    quadro_final
    ;;

  1) rodar_carga k6/rodada-1-100.js   "RODADA 1 — 100 REQUISIÇÕES"    "100 req"    100   ;;
  2) rodar_carga k6/rodada-2-1000.js  "RODADA 2 — 1.000 REQUISIÇÕES"  "1.000 req"  1000  ;;
  4) rodar_carga k6/rodada-4-10000.js "RODADA 4 — 10.000 REQUISIÇÕES" "10.000 req" 10000 ;;

  3)    rodar_contrato ""  ;;
  3exp) rodar_contrato "1" ;;

  cliques)
    cabecalho "TESTE DOS 2 CLIQUES"
    zerar
    echo ""

    SAIDA_CLIQUES="$TRABALHO/cliques.txt"
    k6 run --quiet -e "URL=$BASE" k6/teste-2-cliques.js > "$SAIDA_CLIQUES" 2>&1 || true

    # O k6 embrulha o console.log em 'time=... msg="..." source=console'.
    CLIQUES=$(grep 'clique do VU' "$SAIDA_CLIQUES" | sed -E 's/^.*msg="[[:space:]]*(.*)" source=console.*$/\1/' || true)
    echo -e "  ${NEGRITO}OS DOIS CLIQUES NO ÚLTIMO INGRESSO${FIM}"
    while IFS= read -r linha; do
      [ -z "$linha" ] && continue
      echo "    $linha"
    done <<< "$CLIQUES"
    echo ""

    mostrar_placar || true

    echo -e "  ${NEGRITO}VEREDICTO${FIM}"
    VENDEU_DUAS=$(echo "$CLIQUES" | grep -c 'status 201' || true)
    if [ "$VENDEU_DUAS" -ge 2 ]; then
      echo -e "    ${VERMELHO}✗ VENDEU O MESMO INGRESSO PRAS DUAS PESSOAS${FIM}"
    elif [ "$VENDEU_DUAS" = "1" ]; then
      echo -e "    ${VERDE}✓ um levou, o outro ouviu não${FIM}"
    else
      echo -e "    ${AMARELO}✗ ninguém levou o último ingresso${FIM}"
    fi
    echo ""
    ;;

  placar)
    cabecalho "PLACAR ATUAL"
    mostrar_placar || true
    ;;

  reset)
    cabecalho "LOTE ZERADO"
    zerar
    echo ""
    mostrar_placar || true
    ;;

  *)
    echo "rodada inválida: use tudo, 1, 2, 3, 3exp, 4, cliques, placar ou reset"
    exit 1
    ;;
esac
