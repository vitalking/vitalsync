import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  isSupportedSymbol,
  type ClientMessage,
  type ServerMessage,
  type Symbol,
} from '@vitalsync/shared';
import { config } from './config.js';
import { log } from './logger.js';
import { Hub, type ClientConn } from './hub.js';

export async function startServer(): Promise<void> {
  const hub = new Hub();

  // Pre-arranque de símbolos configurados (no bloquea el arranque del HTTP).
  hub
    .preload(config.preloadSymbols)
    .catch((e) => log.error('[server] preload falló:', (e as Error).message));

  const httpServer = createServer((req, res) => handleHttp(req, res, hub));

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const client: ClientConn & { ws: WebSocket } = {
      id: randomUUID().slice(0, 8),
      ws,
      subscriptions: new Set<Symbol>(),
      send(msg: ServerMessage) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
    };
    log.debug(`[ws] cliente conectado: ${client.id}`);

    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        client.send({ type: 'error', message: 'JSON inválido' });
        return;
      }
      handleClientMessage(hub, client, msg);
    });

    ws.on('close', () => {
      hub.removeClient(client);
      log.debug(`[ws] cliente desconectado: ${client.id}`);
    });

    ws.on('error', () => hub.removeClient(client));

    // Heartbeat por cliente.
    const interval = setInterval(() => {
      if (!alive) {
        ws.terminate();
        clearInterval(interval);
        return;
      }
      alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);
    ws.on('close', () => clearInterval(interval));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, config.host, () => resolve());
  });
  log.info(
    `[server] VITALSYNC v2 escuchando en http://${config.host}:${config.port} (WS: /ws) modo=${config.sourceMode}`,
  );
}

function handleClientMessage(hub: Hub, client: ClientConn, msg: ClientMessage): void {
  switch (msg.type) {
    case 'subscribe': {
      if (!isSupportedSymbol(msg.symbol)) {
        client.send({ type: 'error', message: `Símbolo no soportado: ${msg.symbol}` });
        return;
      }
      hub.subscribe(client, msg.symbol).catch((e) => {
        log.error(`[ws] error suscribiendo ${client.id} a ${msg.symbol}:`, (e as Error).message);
        client.send({ type: 'error', message: `No se pudo suscribir a ${msg.symbol}` });
      });
      break;
    }
    case 'unsubscribe': {
      if (isSupportedSymbol(msg.symbol)) hub.unsubscribe(client, msg.symbol);
      break;
    }
    case 'ping': {
      client.send({ type: 'pong', t: msg.t });
      break;
    }
  }
}

function handleHttp(req: IncomingMessage, res: ServerResponse, hub: Hub): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ symbols: hub.stats(), mode: config.sourceMode }, null, 2));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(
    'VITALSYNC v2 — Servidor agregador en tiempo real\n' +
      'WebSocket: /ws  |  Salud: /health  |  Estado: /stats\n',
  );
}
