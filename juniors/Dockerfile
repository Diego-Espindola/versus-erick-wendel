FROM python:3.13-slim

WORKDIR /app
COPY . .

# O requirements.txt da pasta é um `pip freeze` da máquina toda (bcc, Brlapi,
# cloud-init, cupshelpers...): são pacotes do Ubuntu, não existem no PyPI e
# derrubam o build. Instalamos só o que o main.py realmente importa.
RUN pip install --no-cache-dir fastapi uvicorn

ENV PORT=3000
EXPOSE 3000

# FastAPI não sobe com `python main.py` — quem serve é o uvicorn.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
