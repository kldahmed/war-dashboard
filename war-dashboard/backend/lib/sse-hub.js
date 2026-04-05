'use strict';

/**
 * In-process SSE broadcast hub.
 * Services call broadcast(eventName, payload) after each successful refresh.
 * The signals route registers each HTTP response and fans out events.
 */

const clients = new Set();

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
}

/** How many clients are currently connected. */
function clientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, clientCount };
