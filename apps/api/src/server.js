import { env } from './config/env.js';
import { buildApp } from './app.js';
import { logger } from './utils/logger.js';
import { closeAllPools } from './modules/execution/poolManager.js';

const app = buildApp();

const server = app.listen(env.port, () => {
  logger.info(
    { event: 'server.listening', port: env.port, env: env.nodeEnv },
    `sql-agent listening on :${env.port}`,
  );
});

const shutdown = async (signal) => {
  logger.info({ event: 'server.shutdown.start', signal }, 'graceful shutdown initiated');

  server.close(async (err) => {
    if (err) logger.error({ event: 'server.close.error', err }, 'error closing http server');
    try {
      await closeAllPools();
    } finally {
      logger.info({ event: 'server.shutdown.done' }, 'graceful shutdown complete');
      process.exit(err ? 1 : 0);
    }
  });

  setTimeout(() => {
    logger.error({ event: 'server.shutdown.timeout' }, 'forced exit after 15s');
    process.exit(1);
  }, 15_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'process.unhandledRejection', reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ event: 'process.uncaughtException', err }, 'uncaught exception');
});
