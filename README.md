# versus-erick-wendel

Erick Wendel sem teclado vs. 3 júniors — 2 horas pra fazer uma bilheteria aguentar
10 mil pessoas brigando por 100 ingressos.

Aqui estão os dois sistemas como saíram da mesa, o contrato que os times receberam e a
bateria de testes que julgou os dois no vídeo. Dá pra rodar tudo na sua máquina e chegar
nos mesmos números.

## O que tem aqui

| Pasta         | O quê                                                       |
| ------------- | ----------------------------------------------------------- |
| `erick/`      | o sistema do Erick (Node, `node:http`) — porta **7811**     |
| `juniors/`    | o sistema dos júniors (Python, FastAPI) — porta **7812**    |
| `juniors-js/` | a primeira tentativa deles, em Node — abandonada no meio    |
| `k6/`         | os testes: o contrato regra a regra e as rodadas de carga   |
| `templates/`  | esqueleto que já sobe respondendo HTTP, em 5 linguagens     |

## Rodar e testar

Precisa de **Docker**, **[k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)** e
**jq**:

```bash
brew install k6 jq
```

Sobe o sistema em um terminal:

```bash
docker compose up --build erick
```

E manda o julgamento em outro:

```bash
./k6/rodar.sh erick tudo
```

Troque `erick` por `juniors` pro outro sistema. **Rode um por vez** — os dois juntos
disputam CPU e os números deixam de ser comparáveis.

### O que o `tudo` faz

Quatro etapas em ordem, parando entre elas até você apertar ENTER:

1. **O contrato** — a corretude primeiro. Sai a lista `✓`/`✗` regra por regra e o
   veredicto: _"CUMPRIU 8 DE 24 REGRAS"_.
2. **100 requisições** — o aquecimento.
3. **1.000 requisições** — começa a furar.
4. **10.000 requisições** — o massacre.

Cada rodada de carga mostra três blocos: **o que a API respondeu** (quantos 201, 409,
422, 5xx, contados requisição por requisição), **o que o placar diz** (o `GET /batch`, a
versão do sistema sobre si mesmo) e o **desempenho**. Quando os dois primeiros não
batem, é o momento bom: o sistema respondeu 10.000 ingressos vendidos e o placar dele
jura que o lote está intacto.

No fim vem o quadro consolidado:

```
   RESULTADO FINAL   [juniors]

   ✗  CONTRATO       4/24 regras cumpridas
   ✗  100 req        vendeu 100 em cheio · placar furado · p95 32ms · 2024 req/s
   ✗  1.000 req      vendeu 1000 (+900) · placar furado · p95 106ms · 2795 req/s
   ✗  10.000 req     vendeu 10000 (+9900) · placar furado · p95 158ms · 6704 req/s

   PASSOU EM 0 DE 4 ETAPAS
```

O critério de toda rodada de carga é o mesmo: o lote é de 100, então a API tem que
responder `201` exatamente 100 vezes — nem uma a mais (vendeu o mesmo ingresso duas
vezes), nem uma a menos (deixou ingresso encalhado). Todo o resto é `409`.

Pra rodar direto, sem as pausas:

```bash
AUTO=1 ./k6/rodar.sh erick tudo
```

### Rodadas avulsas

| Comando                        | O que faz                                   |
| ------------------------------ | ------------------------------------------- |
| `./k6/rodar.sh <alvo> 3`       | só o contrato, sem carga                    |
| `./k6/rodar.sh <alvo> 1`       | 100 requisições                             |
| `./k6/rodar.sh <alvo> 4`       | 10.000 de uma vez                           |
| `./k6/rodar.sh <alvo> cliques` | 2 reservas simultâneas no último ingresso   |
| `./k6/rodar.sh <alvo> placar`  | só mostra o `GET /batch`, sem tocar em nada |

A lista completa e como ler cada número estão no **[k6/README.md](./k6/README.md)**.

### Cutucar na mão

```bash
curl http://localhost:7811/batch
curl -X POST http://localhost:7811/reservations \
  -H 'content-type: application/json' \
  -d '{"cpf":"12345678900","quantity":1}'
```

---

# O contrato da API

É ele que os testes conferem. Linguagem, banco e arquitetura são livres.
**Endpoints, formatos e status codes são obrigatórios** — é o que permite o mesmo teste
bater em todos os sistemas igual.

A parte 2 só entrou na metade da prova.

## Parte 1 de 2

Uma API HTTP que:

- sobe na **porta 3000**
- sobe com **um comando só**
- fala **JSON** na entrada e na saída
- aguenta **chamadas em paralelo** sem vender o mesmo ingresso duas vezes

**Regra zero:** lote de **100 ingressos**. O total vendido nunca pode passar de 100.

### 1. Comprar ingresso — `POST /reservations`

**Request**

```json
{ "cpf": "12345678900", "quantity": 1 }
```

**201 — ingresso vendido**

```json
{
  "reservation_id": "uuid",
  "cpf": "12345678900",
  "quantity": 1,
  "status": "SOLD"
}
```

**409 — lote esgotado**

```json
{ "error": "SOLD_OUT" }
```

### 2. Status do lote — `GET /batch`

**200**

```json
{ "total": 100, "sold": 0, "available": 100 }
```

`sold + available` tem que fechar 100. Sempre, em qualquer momento.

### 3. Resetar o lote — `POST /batch/reset`

Devolve o sistema ao estado inicial: lote cheio, nada vendido, nada reservado, nenhum
CPF com ingresso ativo.

**Request** — sem corpo

**200**

```json
{ "total": 100, "sold": 0, "available": 100 }
```

> É o que permite rodar um teste atrás do outro sem derrubar e subir tudo entre eles.
> **Ele é chamado antes de cada rodada.** Se não funcionar, a rodada seguinte começa com
> o lote esgotado.

## Parte 2 de 2

Os endpoints da parte 1 continuam valendo. O que muda é o **ciclo de vida do ingresso**:
a reserva **segura** o ingresso, e só o pagamento confirmado **vende**.

### 1. Criar reserva — `POST /reservations`

_(altera o comportamento da parte 1)_

**Request** — inalterado, mesmo corpo da parte 1

**201 — reserva criada**

```json
{
  "reservation_id": "uuid",
  "cpf": "12345678900",
  "quantity": 1,
  "status": "RESERVED",
  "expires_at": "2026-07-14T15:04:05Z"
}
```

**409 — lote esgotado**

```json
{ "error": "SOLD_OUT" }
```

**422 — limite por CPF excedido**

```json
{ "error": "CPF_LIMIT_EXCEEDED" }
```

### 2. Webhook de pagamento — `POST /webhook/payment`

**Request** — `status` é `"SUCCESS"` ou `"FAILED"`

```json
{ "reservation_id": "uuid", "status": "SUCCESS" }
```

**200 — confirmado**

```json
{ "reservation_id": "uuid", "status": "SOLD" }
```

**200 — falhou, volta pro lote**

```json
{ "reservation_id": "uuid", "status": "RELEASED" }
```

**410 — reserva expirada**

```json
{ "error": "RESERVATION_EXPIRED" }
```

### 3. Status do lote — `GET /batch`

_(ganha o campo `reserved`)_

```json
{ "total": 100, "sold": 0, "reserved": 0, "available": 100 }
```

`sold + reserved + available` tem que fechar 100. Sempre.

### 4. Resetar o lote — `POST /batch/reset`

Continua valendo, e agora limpa também as **reservas** e a contagem por CPF.

```json
{ "total": 100, "sold": 0, "reserved": 0, "available": 100 }
```

### Regras de negócio

- **Lote de 100.** `sold` nunca passa de 100, sob nenhuma condição.
- **Reserva não é venda.** Só o webhook com `SUCCESS` vende.
- **Expiração em 5 minutos.** Reserva não paga volta pro lote automaticamente.
- **Falha devolve.** Webhook com `FAILED` libera o ingresso.
- **Máximo de 2 ingressos ativos por CPF** — reservas e vendas contam juntas.

> **Livre:** linguagem, banco, arquitetura, onde contar o limite, como expirar a
> reserva, como travar a concorrência.
> **Obrigatório:** caminhos dos endpoints, formato de entrada e saída, status codes.

---

## Quer tentar você também?

Copie o template da sua linguagem pra uma pasta sua:

```bash
mkdir minha-api && cp -r templates/node/. minha-api/   # node, python, go, java ou dotnet
```

Adicione o serviço no `docker-compose.yml` apontando pra sua pasta, implemente o
contrato por cima e mande o `./k6/rodar.sh` em cima dele. As regras de empacotamento —
porta 3000, escutando em `0.0.0.0`, `Dockerfile` na raiz — estão no
**[CONTRIBUTING.md](./CONTRIBUTING.md)**.

## Comandos do dia a dia

```bash
docker compose up --build erick      # sobe (rebuilda se mudou o código)
docker compose logs -f erick         # ver os logs
docker compose restart erick         # reiniciar sem rebuildar
docker compose down                  # derruba tudo
```

Mudou o código? `Ctrl+C` e `docker compose up --build erick` de novo.
