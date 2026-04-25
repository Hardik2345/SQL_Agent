import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import insightRoutes from './routes/insight.routes.js';

/**
 * Build a configured Express app. Kept as a factory so tests and the
 * server entry-point share the same construction path.
 */
export const buildApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          brandId: req.headers?.['x-brand-id'],
        }),
      },
    }),
  );

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

  app.use('/insights', insightRoutes);

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: 'E_NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const correlationId = req.correlationId;
    if (err instanceof AppError) {
      req.log?.warn(
        { event: 'app.error', code: err.code, status: err.status, message: err.message },
        'handled application error',
      );
      return res.status(err.status).json({
        ok: false,
        correlationId,
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    req.log?.error({ event: 'app.unhandled', err }, 'unhandled error');
    return res.status(500).json({
      ok: false,
      correlationId,
      error: { code: 'E_INTERNAL', message: 'Internal server error' },
    });
  });

  return app;
};

export default buildApp;
