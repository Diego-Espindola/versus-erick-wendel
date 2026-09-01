// RODADA 2 — 1.000 requisições
// 1.000 pessoas, 100 ingressos. 900 têm que ouvir "não".
// É aqui que o placar trai quem não travou nada.

import { check } from 'k6';
import { cpfUnico, reservar, contar } from './lib/placar.js';

export const options = {
  scenarios: {
    rodada: {
      executor: 'shared-iterations',
      vus: 200,
      iterations: 1000,
      maxDuration: '2m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    // Sem threshold de http_req_failed aqui: 900 das 1.000 respostas são 409, e o
    // k6 conta 409 como falha. O threshold estouraria mesmo no sistema correto.
  },
};

export default function () {
  const res = reservar(cpfUnico());
  contar(res);

  check(res, {
    'status 201 ou 409': (r) => r.status === 201 || r.status === 409,
    'não deu erro de servidor': (r) => r.status < 500,
  });
}
