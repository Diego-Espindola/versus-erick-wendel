// RODADA 4 — 10.000 de uma vez
// O massacre. Decide tudo.
// Quem travou demais pra passar no contrato pode não aguentar a carga.

import { check } from 'k6';
import { cpfUnico, reservar, contar } from './lib/placar.js';

export const options = {
  scenarios: {
    rodada: {
      executor: 'shared-iterations',
      vus: 1000,
      iterations: 10000,
      maxDuration: '5m',
    },
  },
  thresholds: {
    // Aqui não falha o teste — o objetivo é ver o sistema sofrer, não abortar.
    checks: ['rate>0.50'],
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
