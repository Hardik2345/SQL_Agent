import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import { request } from 'undici';
import { env } from '../apps/api/src/config/env.js';
import { createEmbeddingService } from '../apps/api/src/modules/vector/embeddingService.js';
import { assertSemanticMetric } from '../apps/api/src/modules/semantic/semantic.types.js';

const argValue = (name, fallback) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
};

const qdrantHeaders = () => {
  const headers = { 'content-type': 'application/json' };
  if (env.qdrant.apiKey) headers['api-key'] = env.qdrant.apiKey;
  return headers;
};

const qdrantUrl = (path) => new URL(path, env.qdrant.url).toString();

const qdrantJson = async (method, path, body) => {
  const res = await request(qdrantUrl(path), {
    method,
    headers: qdrantHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`qdrant ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
};

const ensureQdrantCollection = async (dimensions) => {
  const collectionPath = `/collections/${env.qdrant.collection}`;
  const res = await request(qdrantUrl(collectionPath), {
    method: 'GET',
    headers: qdrantHeaders(),
  });
  await res.body.text();
  if (res.statusCode === 200) return;
  if (res.statusCode !== 404) {
    throw new Error(`qdrant GET ${collectionPath} -> ${res.statusCode}`);
  }
  await qdrantJson('PUT', collectionPath, {
    vectors: {
      size: dimensions,
      distance: 'Cosine',
    },
  });
};

const ensureQdrantPayloadIndex = async (fieldName) => {
  await qdrantJson('PUT', `/collections/${env.qdrant.collection}/index?wait=true`, {
    field_name: fieldName,
    field_schema: 'keyword',
  });
};

const metricPointId = (metric) => {
  const hex = createHash('sha256')
    .update(`${metric.tenantId}:${metric.metricId}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const embeddingText = (metric) =>
  [
    metric.metricId,
    metric.description ?? '',
    metric.formula ?? '',
    ...(Array.isArray(metric.synonyms) ? metric.synonyms : []),
  ]
    .filter(Boolean)
    .join('\n');

const main = async () => {
  const file = argValue('--file', 'seed/semantic-metrics.example.json');
  if (!env.mongo.uri) throw new Error('MONGO_URI is required');
  if (!env.qdrant.url) throw new Error('QDRANT_URL is required');

  const raw = await readFile(file, 'utf8');
  const metrics = JSON.parse(raw).map((m) => assertSemanticMetric(m));

  const mongo = new MongoClient(env.mongo.uri);
  await mongo.connect();
  const collection = mongo.db(env.mongo.db).collection(env.mongo.metricsCollection);
  await collection.createIndex({ tenantId: 1, metricId: 1 }, { unique: true });
  await collection.createIndex({ tenantId: 1, synonyms: 1 });

  for (const metric of metrics) {
    await collection.updateOne(
      { tenantId: metric.tenantId, metricId: metric.metricId },
      { $set: metric },
      { upsert: true },
    );
  }

  const embedding = await createEmbeddingService();
  await ensureQdrantCollection(embedding.dimensions);
  await ensureQdrantPayloadIndex('tenantId');
  await ensureQdrantPayloadIndex('metricId');

  const points = [];
  for (const metric of metrics) {
    points.push({
      id: metricPointId(metric),
      vector: await embedding.embedText(embeddingText(metric)),
      payload: {
        tenantId: metric.tenantId,
        metricId: metric.metricId,
        type: 'metric',
      },
    });
  }

  await qdrantJson('PUT', `/collections/${env.qdrant.collection}/points?wait=true`, {
    points,
  });

  await mongo.close();
  console.log(`Seeded ${metrics.length} semantic metrics into MongoDB and Qdrant.`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
