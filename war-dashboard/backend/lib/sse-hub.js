'use strict';

/**
 * In-process SSE broadcast hub.
 * Services call broadcast(eventName, payload) after each successful refresh.
 * The signals route registers each HTTP response and fans out events.
 */

const { pool } = require('./db');
const logger = require('./logger');
const { CHANNEL } = require('../modules/signals/service');

const clients = new Set();
let dbListenerClient = null;
let dbListenerStarted = false;
let totalBroadcasts = 0;
let lastEventAt = null;

/**
 * Register an SSE response object.
 * Returns an unsubscribe function.
 * @param {import('http').ServerResponse} res
 * @returns {() => void}
 */
function addClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

/**
 * Broadcast a named SSE event to every connected client.
 * @param {string} eventName
 * @param {object} data
 */
function broadcast(eventName, data) {
  if (clients.size === 0) return;
  const line = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
  totalBroadcasts += 1;
  lastEventAt = new Date().toISOString();
}

/** How many clients are currently connected. */
function clientCount() {
  return clients.size;
}

async function initDbListener() {
  if (dbListenerStarted) return;
  dbListenerStarted = true;
  try {
    dbListenerClient = await pool.connect();
    dbListenerClient.on('notification', (msg) => {
      if (!msg?.payload) return;
      try {
        const payload = JSON.parse(msg.payload);
        if (!payload?.name) return;
        broadcast(payload.name, payload.payload);
      } catch (err) {
        logger.warn('sse_db_notification_parse_failed', { error: err.message });
      }
    });
    dbListenerClient.on('error', (err) => {
      logger.warn('sse_db_listener_error', { error: err.message });
    });
    await dbListenerClient.query(`LISTEN ${CHANNEL}`);
    logger.info('sse_db_listener_started', { channel: CHANNEL });
  } catch (err) {
    logger.warn('sse_db_listener_start_failed', { error: err.message });
    if (dbListenerClient) {
      dbListenerClient.release();
      dbListenerClient = null;
    }
  }
}

function stats() {
  return {
    clients: clients.size,
    total_broadcasts: totalBroadcasts,
    last_event_at: lastEventAt,
    db_listener_started: dbListenerStarted,
    db_listener_active: !!dbListenerClient,
  };
}

module.exports = { addClient, broadcast, clientCount, initDbListener, stats };
