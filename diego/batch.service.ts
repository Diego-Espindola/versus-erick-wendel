import { v4 as uuidv4 } from 'uuid';
import { reservationBuy } from "./index";


class BatchServiceClass {
  private internalBatch: {
    total: number,
    sold: number,
    available: number,
    soldTickets: {
      reservationId: string,
      cpf: string,
    }[]
  }

  constructor(
  ) {
    this.resetBatches();
  }

  resetBatches() {
    this.internalBatch = {
      "total": 100,
      "sold": 0,
      "available": 100,
      "soldTickets": []
    }
  }

  public getBatchesInformation() {
    const i = this.internalBatch;
    return {
      total: i.total,
      sold: i.sold,
      available: i.available,
    };
  }

  public buyTicket(data: reservationBuy) {
    if (data.quantity > 1 || this.internalBatch.soldTickets.some(it => it.cpf = data.cpf)) {
      throw new Error('CPF_LIMIT_EXCEEDED');
    }

    if (this.internalBatch.available == 0) {
      throw new Error('SOLD_OUT');
    }

    return this.buyATicket(data.cpf);
  }

  private buyATicket(cpf: string) {
    if (this.internalBatch.available > 0) {
      const uuid = uuidv4();
      this.internalBatch.available -= 1;
      this.internalBatch.sold += 1;
      this.internalBatch.soldTickets.push({
        cpf,
        reservationId: uuid,
      })

      return {
        reservation_id: uuid,
        cpf: 12345678900,
        quantity: 1,
        status: 'SOLD'
      }
    }
    throw Error('')
  }
}

export const BatchService = new BatchServiceClass();