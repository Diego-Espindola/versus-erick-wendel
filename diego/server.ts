import express from 'express';
import { app } from './index';


const PORT = Number(process.env.PORT) || 3000;


// O '0.0.0.0' é obrigatório — sem ele o container sobe mas não responde de fora.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ouvindo na porta ${PORT}`);
});

