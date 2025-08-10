import { logger } from './logger.js';
import JSON5 from 'json5';

const MAP_STATUS_URL = process.env.MAP_STATUS_URL
  || 'https://raw.githubusercontent.com/<org>/<repo>/main/map-status.json';

export async function fetchMapStatus() {
  logger.info('Fetching map status', { url: MAP_STATUS_URL });

  let res;
  try {
    res = await fetch(MAP_STATUS_URL, {
      headers: { 'Cache-Control': 'no-cache' }
    });
  } catch (e) {
    logger.error('Network error while fetching map status', { error: e.message });
    throw new Error('NETWORK_ERROR');
  }

  const raw = await res.text();
  logger.trace('Map status raw body (first 500 chars)', raw.slice(0, 500));

  if (!res.ok) {
    logger.error('Non-OK HTTP when fetching map status', { status: res.status, bodySnippet: raw.slice(0, 200) });
    throw new Error(`HTTP_${res.status}`);
  }

  let json;
  try {
    json = JSON5.parse(raw); // поддержка комментариев
  } catch (e) {
    logger.error('Invalid JSON in map status', { error: e.message, bodySnippet: raw.slice(0, 200) });
    throw new Error('INVALID_JSON');
  }

  const schemaOk =
    typeof json.enabled === 'boolean' &&
    typeof json.message === 'string' &&
    (json.theme === undefined || typeof json.theme === 'string') &&
    (json.disableUntil === null || json.disableUntil === undefined || typeof json.disableUntil === 'string');

  if (!schemaOk) {
    logger.error('Invalid map-status schema', { json });
    throw new Error('INVALID_SCHEMA');
  }

  logger.info('Map status fetched successfully');
  logger.debug('Map status parsed', json);
  return json;
}
