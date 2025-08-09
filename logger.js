// logger.js
const LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const rank = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

function should(level) {
  return (rank[LEVEL] ?? 2) >= (rank[level] ?? 2);
}

function line(level, msg, meta) {
  const ts = new Date().toISOString();
  const payload = meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : '';
  return `[${ts}] ${level.toUpperCase()} ${msg}${payload ? ' ' + payload : ''}`;
}

export const logger = {
  error: (msg, meta) => should('error') && console.error(line('error', msg, meta)),
  warn:  (msg, meta) => should('warn')  && console.warn(line('warn', msg, meta)),
  info:  (msg, meta) => should('info')  && console.log(line('info', msg, meta)),
  debug: (msg, meta) => should('debug') && console.log(line('debug', msg, meta)),
  trace: (msg, meta) => should('trace') && console.log(line('trace', msg, meta)),
};
