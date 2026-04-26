import pino from 'pino';
import { createRequire } from 'node:module';
import { env, isProduction } from '../config/env.js';

const require = createRequire(import.meta.url);

const baseOptions = {
  level: env.logLevel,
  base: { service: 'sql-agent' },
  redact: {
    paths: [
      'password',
      '*.password',
      'credentials',
      '*.credentials',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'apiKey',
      '*.apiKey',
      'tenant.credentials',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const hasPrettyTransport = () => {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
};

const createLogger = () => {
  if (isProduction || !hasPrettyTransport()) return pino(baseOptions);

  return pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service',
      },
    },
  });
};

export const logger = createLogger();

/**
 * Create a child logger bound to request-scoped context.
 * @param {Record<string, unknown>} bindings
 */
export const childLogger = (bindings) => logger.child(bindings);
