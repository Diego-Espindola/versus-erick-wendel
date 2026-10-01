// TESTE DOS 2 CLIQUES — o de passar na mesa durante o build
// Esgota 99 ingressos e dispara 2 reservas SIMULTÂNEAS no último.
// Vendeu pros dois = furou. Funciona com API meia-pronta, sem carga nenhuma.
//
//   k6 run -e URL=http://localhost:7813 k6/teste-2-cliques.js

import { check } from 'k6';
import { reservar } from './lib/placar.js';

export const options = {
  scenarios: {
    // Consome 99 ingressos, um por vez.
    esgota: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 99,
      exec: 'esgotar',
      maxDuration: '1m',
    },
    // Os 2 cliques no último ingresso, ao mesmo tempo.
    doisCliques: {
      executor: 'per-vu-iterations',
      vus: 2,
      iterations: 1,
      exec: 'clicar',
      startTime: '20s',
    },
  },
};

let contador = 0;

export function esgotar() {
  contador++;
  // CPFs diferentes a cada 2 reservas, pra respeitar o limite por CPF.
  reservar(String(Math.floor(contador / 2)).padStart(11, '0'));
}

export function clicar() {
  const res = reservar(`9999999999${__VU}`);
  check(res, {
    'último ingresso: respondeu 201 ou 409': (r) => r.status === 201 || r.status === 409,
  });
  console.log(`  clique do VU ${__VU}: status ${res.status}`);
}
