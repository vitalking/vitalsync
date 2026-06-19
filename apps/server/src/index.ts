import { startServer } from './wsServer.js';
import { log } from './logger.js';

startServer().catch((err) => {
  log.error('[server] fallo fatal al arrancar:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  log.info('[server] apagando (SIGINT)...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log.info('[server] apagando (SIGTERM)...');
  process.exit(0);
});
