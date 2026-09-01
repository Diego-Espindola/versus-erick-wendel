// RODADA 3 — O CONTRATO (substitui o Postman)
// Sem carga: uma requisição por vez, conferindo TODOS os endpoints, formatos e status
// codes do contrato. Cada check vira uma linha ✓ ou ✗ na tela.
//
//   ./k6/rodar.sh erick 3         → tudo, menos a prova da expiração
//   ./k6/rodar.sh erick 3exp      → inclui a expiração (espera 5 minutos)
//
// O script detecta sozinho se o sistema está na PARTE 1 (venda direta) ou na PARTE 2
// (reserva + webhook), olhando o status devolvido pela primeira reserva.

import { check, sleep } from 'k6';
import { reservar, pagar, batch, placar, resetar, campo, corpo } from './lib/placar.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'],
  },
};

export default function () {
  // ===================================================================
  // 1. GET /batch — o placar existe e fecha a conta
  // ===================================================================
  const resBatch = batch();
  check(resBatch, {
    '1.1 GET /batch responde 200': (r) => r.status === 200,
    '1.2 GET /batch tem os campos total, sold e available': (r) => {
      const b = corpo(r);
      return b.total !== undefined && b.sold !== undefined && b.available !== undefined;
    },
  });

  const inicial = placar();
  check(inicial, {
    '1.3 lote começa com total 100': (b) => b.total === 100,
    '1.4 a conta fecha (sold + reserved + available = total)': (b) =>
      b.sold + b.reserved + b.available === b.total,
  });

  // ===================================================================
  // 2. POST /reservations — formato da resposta 201
  // ===================================================================
  const r1 = reservar('10000000001');
  check(r1, {
    '2.1 POST /reservations responde 201': (r) => r.status === 201,
    '2.2 devolve reservation_id': (r) => !!campo(r, 'reservation_id'),
    '2.3 devolve o cpf enviado': (r) => campo(r, 'cpf') === '10000000001',
    '2.4 devolve quantity': (r) => campo(r, 'quantity') === 1,
    '2.5 status é SOLD (parte 1) ou RESERVED (parte 2)': (r) =>
      campo(r, 'status') === 'SOLD' || campo(r, 'status') === 'RESERVED',
  });

  const id1 = campo(r1, 'reservation_id');
  const parte2 = campo(r1, 'status') === 'RESERVED';
  console.log(parte2 ? '  >> sistema na PARTE 2 (reserva)' : '  >> sistema na PARTE 1 (venda direta)');

  const depoisDaPrimeira = placar();
  check(depoisDaPrimeira, {
    '2.6 o ingresso saiu de available': (b) => b.available === inicial.available - 1,
    '2.7 a conta continua fechando': (b) => b.sold + b.reserved + b.available === b.total,
  });

  if (parte2) {
    check(r1, {
      '2.8 [parte 2] devolve expires_at': (r) => !!campo(r, 'expires_at'),
    });
    check(depoisDaPrimeira, {
      '2.9 [parte 2] reservar NÃO vende (sold não mudou)': (b) => b.sold === inicial.sold,
      '2.10 [parte 2] reserved aumentou': (b) => b.reserved === inicial.reserved + 1,
    });

    // ===================================================================
    // 3. Webhook SUCCESS — vende
    // ===================================================================
    const antesSucesso = placar();
    const wSucesso = pagar(id1, 'SUCCESS');
    check(wSucesso, {
      '3.1 webhook SUCCESS responde 200': (r) => r.status === 200,
      '3.2 devolve o reservation_id': (r) => campo(r, 'reservation_id') === id1,
      '3.3 devolve status SOLD': (r) => campo(r, 'status') === 'SOLD',
    });

    const depoisSucesso = placar();
    check(depoisSucesso, {
      '3.4 SUCCESS aumentou sold': (b) => b.sold === antesSucesso.sold + 1,
      '3.5 SUCCESS baixou reserved': (b) => b.reserved === antesSucesso.reserved - 1,
      '3.6 SUCCESS não mexeu em available': (b) => b.available === antesSucesso.available,
    });

    // ===================================================================
    // 4. Webhook FAILED — devolve o ingresso ao lote
    // ===================================================================
    const antesFalha = placar();
    const r2 = reservar('10000000002');
    const id2 = campo(r2, 'reservation_id');

    const wFalha = pagar(id2, 'FAILED');
    check(wFalha, {
      '4.1 webhook FAILED responde 200': (r) => r.status === 200,
      '4.2 devolve status RELEASED': (r) => campo(r, 'status') === 'RELEASED',
    });

    const depoisFalha = placar();
    check(depoisFalha, {
      '4.3 FAILED devolveu o ingresso ao lote': (b) => b.available === antesFalha.available,
      '4.4 FAILED não vendeu': (b) => b.sold === antesFalha.sold,
      '4.5 FAILED liberou o reserved': (b) => b.reserved === antesFalha.reserved,
    });
  }

  // ===================================================================
  // 5. Limite de 2 ingressos por CPF
  // ===================================================================
  const cpfLimite = '99900000001';
  const l1 = reservar(cpfLimite);
  const l2 = reservar(cpfLimite);
  const l3 = reservar(cpfLimite);

  check(l1, { '5.1 1ª do mesmo CPF passa (201)': (r) => r.status === 201 });
  check(l2, { '5.2 2ª do mesmo CPF passa (201)': (r) => r.status === 201 });
  check(l3, {
    '5.3 3ª do mesmo CPF é bloqueada com 422': (r) => r.status === 422,
    '5.4 erro é CPF_LIMIT_EXCEEDED': (r) => campo(r, 'error') === 'CPF_LIMIT_EXCEEDED',
  });

  // ===================================================================
  // 6. Expiração em 5 minutos (só com 3exp)
  //    Vem ANTES de esgotar o lote — depois não sobra ingresso pra reservar.
  // ===================================================================
  if (__ENV.EXPIRACAO && parte2) {
    // 310s = os 5 minutos do contrato + 10s de folga.
    // Dá pra encurtar pra testar rápido: -e ESPERA=10
    const espera = Number(__ENV.ESPERA || 310);

    const antesExpirar = placar();
    const rExp = reservar('77700000002');

    if (rExp.status !== 201) {
      console.log(`  >> não deu pra testar expiração: reserva devolveu ${rExp.status}`);
    } else {
      const idExp = campo(rExp, 'reservation_id');
      console.log(`  >> aguardando ${espera}s pra ver a reserva expirar...`);
      sleep(espera);

      // Comparação por '>=' e '<=' de propósito: durante a espera, as reservas das
      // provas anteriores também expiram. O que importa é que o ingresso não ficou
      // preso — available não pode ter diminuído, e reserved não pode ter subido.
      const depoisExpirar = placar();
      check(depoisExpirar, {
        '6.1 reserva expirada voltou pro lote': (b) =>
          b.available >= antesExpirar.available && b.reserved <= antesExpirar.reserved,
      });

      const wExpirado = pagar(idExp, 'SUCCESS');
      check(wExpirado, {
        '6.2 webhook em reserva expirada responde 410': (r) => r.status === 410,
        '6.3 erro é RESERVATION_EXPIRED': (r) => campo(r, 'error') === 'RESERVATION_EXPIRED',
      });
    }
  }

  // ===================================================================
  // 7. Lote esgotado — 409 SOLD_OUT
  //    Consome o lote inteiro, então é sempre a última prova.
  // ===================================================================
  const faltam = placar().available;

  for (let i = 0; i < faltam; i++) {
    // 2 por CPF, então troca de CPF a cada 2 ingressos.
    reservar(String(50000000000 + Math.floor(i / 2)));
  }

  const esgotado = placar();
  check(esgotado, {
    '7.1 o lote zerou (available = 0)': (b) => b.available === 0,
    '7.2 não estourou o lote': (b) => b.sold + b.reserved <= b.total,
    '7.3 a conta fecha com o lote cheio': (b) => b.sold + b.reserved + b.available === b.total,
  });

  const rEsgotado = reservar('88800000001');
  check(rEsgotado, {
    '7.4 lote esgotado responde 409': (r) => r.status === 409,
    '7.5 erro é SOLD_OUT': (r) => campo(r, 'error') === 'SOLD_OUT',
  });

  // ===================================================================
  // 8. POST /batch/reset — o que permite rodar as rodadas em sequência.
  //    Vem depois do lote esgotado de propósito: é o pior caso pro reset.
  // ===================================================================
  const resReset = resetar();
  check(resReset, {
    '8.1 POST /batch/reset responde 200': (r) => r.status === 200,
  });

  const depoisReset = placar();
  check(depoisReset, {
    '8.2 reset devolveu o lote cheio': (b) => b.available === b.total,
    '8.3 reset zerou sold e reserved': (b) => b.sold === 0 && b.reserved === 0,
  });

  // O reset também tem que limpar a contagem por CPF — senão o CPF que bateu no
  // limite na prova 5 continua bloqueado na rodada seguinte.
  const rDepoisReset = reservar(cpfLimite);
  check(rDepoisReset, {
    '8.4 reset limpou a contagem por CPF': (r) => r.status === 201,
  });
}
