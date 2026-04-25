import pino from 'pino';
import { env, isProduction } from '../config/env.js';

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

export const logger = isProduction
  ? pino(baseOptions)
  : pino({
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

/**
 * Create a child logger bound to request-scoped context.
 * @param {Record<string, unknown>} bindings
 */
export const childLogger = (bindings) => logger.child(bindings);
