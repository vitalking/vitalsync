import { config } from './config.js';

const ts = () => new Date().toISOString();

export const log = {
  info: (...args: unknown[]) => console.log(`[${ts()}] [INFO]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args: unknown[]) => console.error(`[${ts()}] [ERROR]`, ...args),
  debug: (...args: unknown[]) => {
    if (config.verbose) console.log(`[${ts()}] [DEBUG]`, ...args);
  },
};
