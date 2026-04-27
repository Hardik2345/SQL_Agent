import { env } from '../../config/env.js';

/**
 * @param {{
 *   brokers?: string[],
 *   clientId?: string,
 *   ssl?: boolean,
 *   saslMechanism?: string,
 *   saslUsername?: string,
 *   saslPassword?: string,
 * }} [cfg]
 * @returns {Promise<any>}
 */
export const createKafkaClient = async (cfg = {}) => {
  const { Kafka } = await import('kafkajs');
  const brokers = cfg.brokers ?? env.kafka.brokers;
  const saslUsername = cfg.saslUsername ?? env.kafka.saslUsername;
  const saslPassword = cfg.saslPassword ?? env.kafka.saslPassword;
  /** @type {any} */
  const sasl = saslUsername
    ? {
      mechanism: (cfg.saslMechanism ?? env.kafka.saslMechanism) || 'plain',
      username: saslUsername,
      password: saslPassword,
    }
    : undefined;

  return new Kafka({
    clientId: cfg.clientId ?? env.kafka.clientId,
    brokers,
    ssl: cfg.ssl ?? env.kafka.ssl,
    sasl,
  });
};
