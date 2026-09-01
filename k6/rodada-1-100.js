// RODADA 1 — 100 requisições simultâneas
// O aquecimento: exatamente 100 pessoas pro lote de 100. Todo mundo tem que passar.

import { check } from 'k6';
import { cpfUnico, reservar, contar } from './lib/placar.js';

export const options = {
  scenarios: {
    rodada: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      maxDuration: '1m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
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
