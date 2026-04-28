/**
 * Planner-facing table curation and responsibility metadata.
 *
 * This does not change the real validation schema. The validator still
 * receives the full tenant schema. These annotations only control what
 * the LLM sees while planning / compiling, so it reasons over the intended
 * analytics surface instead of every operational/staging table in the dump.
 */

export const TABLE_METADATA = Object.freeze({
  shopify_orders: {
    grain: 'order line item',
    responsibility:
      'Primary Shopify order-line fact table. Use for product-level order metrics, product filters, cancellation/refund/paid-order counts, customer/order dimensions, and order revenue at line-item grain.',
    useFor:
      'product_id filters; order_id distinct counts; financial_status based cancellation/refund/paid-order metrics; created_at/created_date order windows.',
    avoid:
      'Do not count rows as orders. Use COUNT(DISTINCT order_id) for order-level metrics because this table is line-item grain.',
  },
  shopify_orders_update: {
    grain: 'updated order line item',
    responsibility:
      'Updated Shopify order-line fact table. Use when the question explicitly asks about updates or updated_at/updated_date driven order changes.',
    useFor:
      'updated_date/updated_at windows, changed order state, product_id filters with latest update data.',
    avoid:
      'Do not use as the default order table when the question asks normal order creation windows; prefer shopify_orders.',
  },
  shopify_orders_utm_daily: {
    grain: 'daily product x UTM aggregate',
    responsibility:
      'Daily Shopify order performance by product and UTM fields.',
    useFor:
      'product-level UTM attribution aggregates when product_id and UTM dimensions are both needed.',
    avoid:
      'Do not use for order-wise cancellation unless order_id-level logic is not required.',
  },
  hourly_product_performance_rollup: {
    grain: 'hourly product aggregate',
    responsibility:
      'Hourly product sales/performance rollup. Use for product-level sales, quantity, and revenue trends when order-level status is not needed.',
    useFor:
      'product_id sales/time-series rollups by date/hour.',
    avoid:
      'Do not use for order-wise cancellation/refund rates; it does not provide order_id-level cancellation logic.',
  },
  hourly_product_sessions: {
    grain: 'hourly product session aggregate',
    responsibility:
      'Hourly product session and behavior rollup.',
    useFor:
      'product_id session trends, views, conversion-adjacent session metrics by date/hour.',
    avoid:
      'Do not use for order-level cancellation or return metrics.',
  },
  hourly_sessions_summary: {
    grain: 'hourly site session aggregate',
    responsibility:
      'Hourly site-wide session summary from analytics/session data.',
    useFor:
      'overall website/app session trends, add-to-cart session trends, device-level session breakdowns, and site-wide conversion denominator at hourly grain.',
    avoid:
      'Do not use for product_id filters or order-level cancellation/refund metrics. It has sessions only, not order-line grain.',
  },
  hourly_sessions_summary_shopify: {
    grain: 'hourly Shopify session aggregate',
    responsibility:
      'Hourly site-wide Shopify session summary.',
    useFor:
      'overall Shopify session trends, add-to-cart session trends, device-level session breakdowns, and site-wide conversion denominator at hourly grain.',
    avoid:
      'Do not use for product_id filters or order-level cancellation/refund metrics. It has sessions only, not order-line grain.',
  },
  mv_product_sessions_by_campaign_daily: {
    grain: 'daily product x campaign session aggregate',
    responsibility:
      'Materialized daily product sessions by campaign.',
    useFor:
      'product_id campaign/session analysis at daily grain.',
    avoid:
      'Do not use for order-level cancellation/refund calculations.',
  },
  mv_product_sessions_by_path_daily: {
    grain: 'daily product x path session aggregate',
    responsibility:
      'Materialized daily product sessions by landing/referrer path.',
    useFor:
      'product_id path/session analysis at daily grain.',
    avoid:
      'Do not use for order-level cancellation/refund calculations.',
  },
  mv_product_sessions_by_type_daily: {
    grain: 'daily product x session type aggregate',
    responsibility:
      'Materialized daily product sessions by traffic/session type.',
    useFor:
      'product_id session-type analysis at daily grain.',
    avoid:
      'Do not use for order-level cancellation/refund calculations.',
  },
  product_landing_mapping: {
    grain: 'product landing mapping',
    responsibility:
      'Mapping table for product IDs to landing paths/pages.',
    useFor:
      'joining product analytics to landing-page/path metadata.',
    avoid:
      'Do not use as a metric fact table.',
  },
  product_landing_page_map: {
    grain: 'product landing-page mapping',
    responsibility:
      'Mapping table for product IDs to landing page URLs.',
    useFor:
      'joining product analytics to landing-page metadata.',
    avoid:
      'Do not use as a metric fact table.',
  },
  product_sessions_snapshot: {
    grain: 'product session snapshot',
    responsibility:
      'Snapshot of product session data.',
    useFor:
      'current/recent product session lookup where a snapshot is explicitly appropriate.',
    avoid:
      'Prefer hourly/daily product rollups for trend questions.',
  },
  products_sold_units_daily: {
    grain: 'daily product units aggregate',
    responsibility:
      'Daily sold-unit counts by product.',
    useFor:
      'product_id unit sales trends and daily sold quantity.',
    avoid:
      'Do not use for revenue or cancellation rates unless required columns exist.',
  },
  returns_fact: {
    grain: 'return event fact',
    responsibility:
      'Return event fact table keyed by order_id and event details.',
    useFor:
      'return/refund event analysis and joining return events to order/product facts through order_id when needed.',
    avoid:
      'Do not treat returns as cancellations; cancellation rate should come from order cancellation status unless the user explicitly asks about returns.',
  },
  overall_summary: {
    grain: 'daily site aggregate',
    responsibility:
      'Daily site-wide business summary with sales, orders, sessions, and add-to-cart sessions.',
    useFor:
      'overall store/site conversion rate, total sales, net sales, gross sales, total orders, total sessions, and daily site-wide KPI trends.',
    avoid:
      'Do not use for product_id, order_id, customer_id, SKU, or UTM-specific filters. This table is already aggregated across those dimensions.',
  },
  utm_campaign_hourly: {
    grain: 'hourly UTM campaign aggregate',
    responsibility:
      'Hourly campaign-level UTM aggregate.',
    useFor: 'campaign-level hourly marketing/session/order trends.',
    avoid: 'Do not use for product_id filters; this is campaign grain.',
  },
  utm_medium_campaign_hourly: {
    grain: 'hourly UTM medium x campaign aggregate',
    responsibility:
      'Hourly UTM medium and campaign aggregate.',
    useFor: 'medium/campaign hourly marketing trends.',
    avoid: 'Do not use for product_id filters; this is UTM grain.',
  },
  utm_medium_hourly: {
    grain: 'hourly UTM medium aggregate',
    responsibility:
      'Hourly UTM medium aggregate.',
    useFor: 'medium-level hourly marketing trends.',
    avoid: 'Do not use for product_id filters; this is UTM grain.',
  },
  utm_source_campaign_hourly: {
    grain: 'hourly UTM source x campaign aggregate',
    responsibility:
      'Hourly UTM source and campaign aggregate.',
    useFor: 'source/campaign hourly marketing trends.',
    avoid: 'Do not use for product_id filters; this is UTM grain.',
  },
  utm_source_hourly: {
    grain: 'hourly UTM source aggregate',
    responsibility:
      'Hourly UTM source aggregate.',
    useFor: 'source-level hourly marketing trends.',
    avoid: 'Do not use for product_id filters; this is UTM grain.',
  },
  utm_source_medium_campaign_hourly: {
    grain: 'hourly UTM source x medium x campaign aggregate',
    responsibility:
      'Most detailed hourly UTM source/medium/campaign aggregate.',
    useFor: 'source/medium/campaign hourly marketing trends.',
    avoid: 'Do not use for product_id filters; this is UTM grain.',
  },
  utm_source_medium_hourly: {
    grain: 'hourly UTM source x medium aggregate',
    responsibility:
      'Hourly UTM source and medium aggregate.',
    useFor: 'source/medium hourly marketing trends.',
    avoid: 'Do not use for product_id filters; this is UTM grain.',
  },
});

const CURATED_ANALYTICS_TABLES = Object.freeze(Object.keys(TABLE_METADATA));

/**
 * @param {string} tableName
 */
export const getTableMetadata = (tableName) => TABLE_METADATA[tableName] ?? null;

/**
 * Planner should see the curated analytics surface when the schema has it.
 * Test fixtures and tiny custom schemas fall back to their full allowed list.
 *
 * @param {import('./schema.types.js').SchemaContext} schemaContext
 * @returns {string[]}
 */
export const getPlannerVisibleTables = (schemaContext) => {
  const curated = CURATED_ANALYTICS_TABLES.filter((tableName) =>
    schemaContext.allowedTables.includes(tableName),
  );
  return curated.length > 0 ? curated : schemaContext.allowedTables.slice();
};

/**
 * @param {string} tableName
 */
export const formatTableMetadata = (tableName) => {
  const meta = getTableMetadata(tableName);
  if (!meta) return '';
  return [
    `grain=${meta.grain}`,
    `responsibility=${meta.responsibility}`,
    `use_for=${meta.useFor}`,
    `avoid=${meta.avoid}`,
  ].join('; ');
};
