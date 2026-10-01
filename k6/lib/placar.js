import http from 'k6/http';
import { Counter } from 'k6/metrics';

export const URL = __ENV.URL || 'http://localhost:7813';

// O que a API respondeu, contado na fonte. É o número que vai pro quadro final:
// o placar do GET /batch é a versão do sistema sobre si mesmo, isto aqui é o que
// ele de fato entregou pra quem chamou.
export const respostas = {
  vendidas: new Counter('resp_201'),   // 201 — levou o ingresso
  recusadas: new Counter('resp_409'),  // 409 — SOLD_OUT, resposta correta com lote cheio
  limite: new Counter('resp_422'),     // 422 — limite por CPF
  quebradas: new Counter('resp_5xx'),  // 5xx — o servidor caiu na cara
  estranhas: new Counter('resp_outros'), // qualquer outra coisa (403, 404, timeout...)
};

// Classifica UMA resposta. Chame em toda requisição das rodadas de carga.
export function contar(res) {
  if (res.status === 201) respostas.vendidas.add(1);
  else if (res.status === 409) respostas.recusadas.add(1);
  else if (res.status === 422) respostas.limite.add(1);
  else if (res.status >= 500 || res.status === 0) respostas.quebradas.add(1);
  else respostas.estranhas.add(1);
}

const JSON_HEADERS = { 'content-type': 'application/json' };

// CPF único por (VU, iteração) — evita esbarrar no limite de 2 por CPF durante a carga.
export function cpfUnico() {
  return String(__VU * 1000000 + __ITER).padStart(11, '0');
}

export function reservar(cpf, quantity = 1) {
  return http.post(`${URL}/reservations`, JSON.stringify({ cpf, quantity }), {
    headers: JSON_HEADERS,
  });
}

export function pagar(reservationId, status) {
  return http.post(
    `${URL}/webhook/payment`,
    JSON.stringify({ reservation_id: reservationId, status }),
    { headers: JSON_HEADERS }
  );
}

export function batch() {
  return http.get(`${URL}/batch`);
}

export function resetar() {
  return http.post(`${URL}/batch/reset`, null, { headers: JSON_HEADERS });
}

// Lê o corpo inteiro como objeto, ou {} quando não é JSON.
export function corpo(res) {
  try {
    const b = res.json();
    return b && typeof b === 'object' ? b : {};
  } catch (_) {
    return {};
  }
}

// Lê um campo do corpo sem explodir quando a resposta não é JSON.
// Sistema meio pronto responde 'not found' em texto puro — e um throw aqui aborta
// a iteração inteira do k6, matando as provas seguintes do contrato.
export function campo(res, nome) {
  try {
    return res.json(nome);
  } catch (_) {
    return undefined;
  }
}

// Lê o placar como objeto, com os campos que faltam zerados.
// Na parte 1 do contrato o campo 'reserved' ainda não existe — por isso 'reserved'
// cai pra 0, e não pra NaN: ausência dele é legítima.
//
// Quando o GET /batch não responde placar nenhum, os campos viram NaN de propósito.
// Zerar daria crédito de graça: '7.1 available === 0' passaria em quem não tem
// endpoint de placar. NaN nunca é igual a nada, então toda prova que depende do
// placar falha sozinha — inclusive as que vierem a ser escritas depois.
export function placar() {
  const res = batch();
  const b = corpo(res);
  const temPlacar =
    res.status === 200 &&
    b.total !== undefined &&
    b.sold !== undefined &&
    b.available !== undefined;

  if (!temPlacar) {
    return { total: NaN, sold: NaN, reserved: NaN, available: NaN };
  }

  return {
    total: b.total,
    sold: b.sold,
    reserved: b.reserved ?? 0,
    available: b.available,
  };
}

// O placar bonito é impresso pelo rodar.sh, depois do k6 —
// o console.log do k6 vem com prefixo de log e fica ilegível na tela.
