# k6 — os testes que julgaram os dois sistemas

São estes testes que aparecem no vídeo. Rodam em qualquer API que siga o
[contrato](../README.md#o-contrato-da-api), inclusive na sua.

## 1. Instalação

```bash
brew install k6 jq
k6 version
```

O `jq` é usado pelo `rodar.sh` pra ler o placar e as métricas.

## 2. O básico: como se roda um teste

O comando cru é:

```bash
k6 run -e URL=http://localhost:7813 k6/rodada-1-100.js
```

- `k6 run <arquivo>` executa o script
- `-e NOME=valor` passa variável de ambiente (aqui, qual sistema atacar)

**Mas prefira o `rodar.sh`**, que faz três coisas a mais: zera o lote antes (via
`POST /batch/reset`), garante que o sistema está de pé, e imprime o placar limpo no
final.

```bash
./k6/rodar.sh erick 1
```

## 3. O julgamento — o comando completo

```bash
./k6/rodar.sh erick tudo
```

Roda as quatro etapas em ordem, **parando entre elas até você apertar ENTER** — o ritmo
é seu:

1. **O CONTRATO** — a corretude primeiro. Sai a lista `✓`/`✗` regra por regra e o
   veredicto: *"CUMPRIU 8 DE 24 REGRAS"*.
2. **100 requisições** — o aquecimento.
3. **1.000 requisições** — começa a furar.
4. **10.000 requisições** — o massacre.

Cada etapa de carga mostra três blocos: **o que a API respondeu** (quantos 201, 409,
422, 5xx — contado na fonte, requisição por requisição), **o que o placar diz** (o
`GET /batch`, a versão do sistema sobre si mesmo) e o **desempenho**. Quando os dois
primeiros não batem é onde mora a graça: o sistema respondeu 10.000 ingressos vendidos
e o placar dele jura que o lote está intacto.

No fim vem o quadro consolidado:

```
   RESULTADO FINAL   [juniors]

   ✗  CONTRATO       4/24 regras cumpridas
   ✗  100 req        vendeu 100 em cheio · placar furado · p95 32ms · 2024 req/s
   ✗  1.000 req      vendeu 1000 (+900) · placar furado · p95 106ms · 2795 req/s
   ✗  10.000 req     vendeu 10000 (+9900) · placar furado · p95 158ms · 6704 req/s

   PASSOU EM 0 DE 4 ETAPAS
```

Para rodar sem as pausas:

```bash
AUTO=1 ./k6/rodar.sh erick tudo
```

**O critério de cada rodada de carga é o mesmo:** o lote é de 100, então a API tem que
responder `201` exatamente 100 vezes — nem uma a mais (vendeu duas vezes o mesmo
ingresso), nem uma a menos (deixou ingresso encalhado). Todo o resto é `409`.

## 4. As rodadas avulsas

| Comando | O que faz |
|---|---|
| `./k6/rodar.sh <alvo> tudo` | o julgamento completo, as 4 etapas |
| `./k6/rodar.sh <alvo> 1` | 100 requisições — o aquecimento |
| `./k6/rodar.sh <alvo> 2` | 1.000 requisições — começa a furar |
| `./k6/rodar.sh <alvo> 3` | contrato completo, sem carga |
| `./k6/rodar.sh <alvo> 3exp` | contrato + prova da expiração (espera 5 min) |
| `./k6/rodar.sh <alvo> 4` | 10.000 de uma vez — o massacre |
| `./k6/rodar.sh <alvo> cliques` | 2 reservas simultâneas no último ingresso |
| `./k6/rodar.sh <alvo> placar` | só mostra o placar, sem zerar nada |
| `./k6/rodar.sh <alvo> reset` | só zera o lote |

Alvos: **`erick`** (porta 7813) e **`juniors`** (7812). Pra apontar pra uma API sua,
acrescente o alvo no `case $ALVO in` do `rodar.sh` com a porta dela.

## 5. Como ler a saída

No fim de cada rodada sai o placar, lido do `GET /batch`:

```
  RODADA 2 — 1.000 REQUISIÇÕES  [juniors]
  ──────────────────────────────────
  VENDIDOS ......... 152
  RESERVADOS ....... 0
  DISPONÍVEIS ...... -52
  LOTE ............. 100
  ──────────────────────────────────
  >>> ESTOUROU O LOTE: vendeu 152 de 100 <<<
```

Verde `lote íntegro` = passou. Vermelho = furou.

Nas métricas do k6, os três números que importam:

- **`http_req_duration` → `p(95)`** — o tempo de resposta. É o critério de desempate.
- **`http_reqs`** — quantas requisições por segundo o sistema aguentou.
- **`checks_succeeded`** — quantos checks passaram. Na rodada 3, cada linha `✓`/`✗` é
  uma regra do contrato.

## 6. Rodada 3: o teste que substitui o Postman

Ela confere **todos os endpoints, formatos e status codes** do contrato, um por um:

```
✓ 1.1 GET /batch responde 200
✓ 2.1 POST /reservations responde 201
✓ 2.3 devolve o cpf enviado
✓ 2.9 [parte 2] reservar NÃO vende (sold não mudou)
✓ 3.3 devolve status SOLD
✓ 4.2 devolve status RELEASED
✓ 5.3 3ª do mesmo CPF é bloqueada com 422
✓ 7.4 lote esgotado responde 409
```

São **38 checks** na parte 2 do contrato, **24** na parte 1 (41 com a prova da expiração).
Cada `✗` na tela é um item do contrato que o sistema não cumpriu.

**O script detecta sozinho** se o sistema está na parte 1 (venda direta) ou na parte 2
(reserva + webhook), olhando o `status` da primeira reserva. Não precisa configurar nada.
É por isso que o denominador muda: quem só entregou a parte 1 é julgado pelas 24 regras
que se aplicam a ele.

**Sistema meio pronto não derruba a rodada.** Resposta que não é JSON (um `not found`
em texto puro, por exemplo) falha o check daquela regra e a lista continua até o fim, em
vez de abortar na terceira linha. E sistema sem `GET /batch` não ganha regra de graça:
as provas que dependem do placar falham todas.

### A prova da expiração

Leva 5 minutos parados, então fica de fora por padrão. Pra incluir:

```bash
./k6/rodar.sh erick 3exp
```

Pra conferir sem esperar 5 minutos, encurte a espera (só funciona se o sistema também
estiver com expiração curta):

```bash
k6 run -e URL=http://localhost:7813 -e EXPIRACAO=1 -e ESPERA=10 k6/rodada-3-contrato.js
```

## 7. Comparando os dois lado a lado

Um sistema por vez — os dois juntos disputam CPU e os números deixam de ser
comparáveis:

```bash
./k6/rodar.sh erick tudo
./k6/rodar.sh juniors tudo
```

Se preferir intercalar etapa por etapa:

```bash
./k6/rodar.sh erick 3     &&  ./k6/rodar.sh juniors 3     # contrato
./k6/rodar.sh erick 1     &&  ./k6/rodar.sh juniors 1     # rodada 1
./k6/rodar.sh erick 2     &&  ./k6/rodar.sh juniors 2     # rodada 2
./k6/rodar.sh erick 4     &&  ./k6/rodar.sh juniors 4     # o massacre
```

O teste dos 2 cliques serve pra API ainda meia-pronta, sem carga nenhuma — dá pra rodar
enquanto você ainda está implementando:

```bash
./k6/rodar.sh erick cliques
```

## 8. Detalhes que podem te morder

**Quem não implementar o `POST /batch/reset` paga em tempo.** O `rodar.sh` tenta o reset
primeiro; se ele não responder 200, cai pra reiniciar o container — o que leva alguns
segundos e não limpa banco com volume. O aviso aparece em amarelo:

```
>> /batch/reset respondeu 404 — reiniciando o container
```

Vale conferir esse endpoint antes de começar:

```bash
./k6/rodar.sh erick reset && ./k6/rodar.sh juniors reset
```

**Os CPFs são únicos por requisição** nas rodadas de carga. É de propósito: com CPF
repetido, o limite de 2 por CPF bloquearia quase tudo e a carga não testaria a trava do
lote, que é o que interessa.

**A rodada 4 não falha por threshold.** O objetivo é ver o sistema sofrer até o fim, não
abortar o teste no meio. Quem decide se passou é o placar.

**A rodada 3 esgota o lote** na última prova (pra testar o 409). Sempre rode ela pelo
`rodar.sh`, que zera o sistema antes.
