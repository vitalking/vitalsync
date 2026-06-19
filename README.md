# VITALSYNC v2

Dashboard profesional de **Binance Futures en tiempo real** — precio tick a tick, libro de
órdenes completo, liquidaciones, funding y open interest. Pensado para rendimiento tipo
CoinGlass: una sola conexión a Binance que se reparte (fan-out) a todos los clientes.

> Interfaz 100 % en español · estética VITALSYNC (oscuro + cian).

---

## Arquitectura

VITALSYNC v2 es un **monorepo** con dos despliegues independientes:

```
vitalsync/
├── apps/
│   ├── web/         → Frontend Next.js (App Router)        ── se despliega en VERCEL
│   └── server/      → Servidor agregador Node.js + ws      ── se despliega en RAILWAY / RENDER / FLY
├── packages/
│   └── shared/      → Protocolo de mensajes y tipos (TS)
└── legacy/          → MVP original (referencia histórica)
```

### ¿Por qué el servidor NO va en Vercel?

Vercel es *serverless*: las funciones no mantienen conexiones WebSocket persistentes. El
servidor agregador necesita un proceso **always-on** que mantenga una conexión viva con
Binance y haga *fan-out* a los clientes. Por eso:

- **`apps/web`** → Vercel (estático + SSR).
- **`apps/server`** → una plataforma con procesos persistentes (Railway, Render o Fly.io).

El frontend se conecta al servidor por `wss://` mediante la variable `NEXT_PUBLIC_WS_URL`.

### Flujo de datos

```
Binance Futures ─┐
 (1 conexión)    │   ┌──────────────────────┐        ┌───────────────┐
  aggTrade       ├──▶│  apps/server          │        │  apps/web      │
  markPrice@1s   │   │  · OrderBookManager   │  wss   │  · MarketStore │
  depth@100ms    │   │  · SymbolAggregator   │◀──────▶│  · Canvas rAF  │
  forceOrder     │   │  · Hub (fan-out)      │        │  · Order book  │
  ticker         │   └──────────────────────┘        └───────────────┘
 + OI por REST ──┘
```

### Rendimiento ("tick a tick sin tildarse")

- Los datos crudos se guardan en un **ring buffer** (`Float64Array`) y se mutan en sitio.
- El **gráfico canvas** corre su propio bucle `requestAnimationFrame` con **interpolación**
  del precio y **autoescala suavizada** → movimiento continuo independiente de los fps.
- React solo re-renderiza los paneles numéricos a baja frecuencia (~6-7 fps) y el libro a
  ~10 fps. Así se desacopla el ritmo de datos del de render y se evita el *jank*.

---

## Fuente de datos y geo-bloqueo de Binance

Binance responde **HTTP 451** desde muchas IPs de datacenter (regiones restringidas). El
servidor incluye una abstracción de fuente con dos implementaciones, controladas por
`SOURCE_MODE`:

| `SOURCE_MODE` | Comportamiento                                                        |
| ------------- | --------------------------------------------------------------------- |
| `binance`     | Solo datos reales. Falla si Binance está bloqueado.                   |
| `simulated`   | Datos sintéticos realistas (demo, o regiones bloqueadas).             |
| `auto`        | Intenta Binance y cae a simulado si falla el handshake. *(por defecto)* |

> **Para producción real:** despliega el servidor en una **región que Binance permita**
> (evita EE. UU.). Railway y Render permiten elegir región.

---

## Desarrollo local

Requisitos: Node.js 20+.

```bash
# 1. Instalar dependencias (workspaces)
npm install

# 2. Servidor agregador (terminal 1) — modo simulado para probar en cualquier sitio
SOURCE_MODE=simulated npm run dev:server

# 3. Frontend (terminal 2)
npm run dev:web
```

- Servidor: http://localhost:8080 (WS en `/ws`, salud en `/health`, estado en `/stats`).
- Frontend: http://localhost:3000

Crea `apps/web/.env.local` con `NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws`
(ver `apps/web/.env.example`).

---

## Despliegue

### 1) Servidor agregador — Railway / Render / Fly

Opción A · **Comandos** (Railway/Render con Node):

- Root directory: raíz del repo
- Install: `npm install`
- Build: `npm run build:server`
- Start: `npm run start:server`
- Variables: `SOURCE_MODE=auto` (o `binance`), `PORT` (lo inyecta la plataforma).

Opción B · **Docker** (Fly.io o Docker):

```bash
docker build -f apps/server/Dockerfile -t vitalsync-server .
docker run -p 8080:8080 -e SOURCE_MODE=auto vitalsync-server
```

Verifica: `GET https://<tu-servidor>/health` → `{"status":"ok"}`.

### 2) Frontend — Vercel

1. Importa el repo en Vercel.
2. **Root Directory:** `apps/web` (Vercel detecta el monorepo y ejecuta el install en la raíz).
3. Variable de entorno: `NEXT_PUBLIC_WS_URL = wss://<tu-servidor>/ws`.
4. Deploy.

> Usa `wss://` (TLS) en producción: una web servida por HTTPS no puede conectarse a un
> WebSocket `ws://` sin cifrar.

---

## Variables de entorno

### Servidor (`apps/server`)

| Variable          | Por defecto                  | Descripción                                  |
| ----------------- | ---------------------------- | -------------------------------------------- |
| `PORT`            | `8080`                       | Puerto HTTP/WS.                              |
| `SOURCE_MODE`     | `auto`                       | `binance` · `simulated` · `auto`.            |
| `PRELOAD_SYMBOLS` | `BTCUSDT`                    | Símbolos pre-cargados al iniciar.            |
| `BOOK_DEPTH`      | `25`                         | Niveles de profundidad enviados a la UI.     |
| `BOOK_BROADCAST_MS` | `100`                      | Frecuencia de difusión del libro.            |
| `OI_POLL_MS`      | `15000`                      | Polling de Open Interest.                    |

### Frontend (`apps/web`)

| Variable             | Descripción                                  |
| -------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_WS_URL` | URL del servidor WebSocket (`wss://…/ws`).   |

---

## Símbolos soportados

`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT` (configurable en
`packages/shared/src/index.ts`).
