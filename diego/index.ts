import express from 'express';
import { BatchService } from './batch.service';

export const app = express();

app.use(express.json());

export type reservationBuy = { cpf: string, quantity: number };

app.post("/reservations", (req, res) => {
  const body: reservationBuy = req.body;
  if (!body.cpf || !body.quantity) {
    res.status(409).send("Faltando campos no body");
  }

  try {
    const result = BatchService.buyTicket(body);
    res.status(201).send(result)
  } catch ({ e, message }) {
    let errorCode = 500;
    switch (message) {
      case 'SOLD_OUT':
        errorCode = 409
      case 'CPF_LIMIT_EXCEEDED':
        errorCode = 422
    }

    res.status(errorCode).send({ error: message });
  }
});

app.get("/batch", (req, res) => {
  const result = BatchService.getBatchesInformation();
  res.status(200).send(result);
});

app.post("/batch/reset", (req, res) => {
  BatchService.resetBatches();
  const result = BatchService.getBatchesInformation();
  res.status(200).send(result);
});


