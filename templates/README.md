# Templates

Cada pasta é um **projeto que já sobe e responde HTTP**. Copie a pasta inteira, rode uma
vez pra confirmar que está de pé, e comece a implementar o contrato por cima.

```bash
cp -r templates/node/. erick/       # ou juniors/
```

| Linguagem | Arquivos                             | Servidor                 |
| --------- | ------------------------------------ | ------------------------ |
| `node`    | `index.js`, `package.json`           | `node:http`              |
| `python`  | `main.py`                            | `ThreadingHTTPServer`    |
| `go`      | `main.go`, `go.mod`                  | `net/http`               |
| `java`    | `Main.java`                          | `com.sun.net.httpserver` |
| `dotnet`  | `Program.cs`, `app.csproj`           | Minimal API              |

Todos os cinco foram testados: buildam, sobem e respondem `{"status":"ok"}` na raiz.

## Por que nenhum usa framework

**Zero dependências externas.** Assim o build não precisa de internet — só da imagem base.
Com o ambiente offline, `npm install` e `pip install` falham; biblioteca padrão não.

Você **pode** usar Express, FastAPI, Spring, o que quiser — só teste o build antes de
depender disso, e lembre que baixar dependência exige internet.

## Se sua linguagem não está aqui

Escreva o seu Dockerfile. Só precisa respeitar as [3 regras](../CONTRIBUTING.md):
porta 3000, escutar em `0.0.0.0`, `Dockerfile` na raiz da sua pasta.
