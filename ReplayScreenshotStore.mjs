/**
 * In-memory store for Chrome replay step screenshots (base64 JPEG).
 * Same screenshotSessionId can be fetched until TTL cleanup (aligned with ReportProgress).
 */

const store = new Map();

const TEN_MINUTES_SECONDS = 10 * 60;

function getUnixTimestampInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function getEntry(sessionId) {
  return store.get(sessionId);
}

/**
 * @param {string} sessionId
 * @param {{ status: 'COMPLETED' | 'FAILED', screenshotsBase64: string[], error?: string }} entry
 */
export function setEntry(sessionId, entry) {
  store.set(sessionId, { ...entry, updatedAt: getUnixTimestampInSeconds() });
}

/**
 * @param {(msg: string, key?: string, shouldSave?: boolean) => void} [log]
 */
export function startCleanupInterval(log = console.log) {
  setInterval(() => {
    const now = getUnixTimestampInSeconds();
    let ctr = 0;
    for (const [sessionId, entry] of store.entries()) {
      if (now - entry.updatedAt > TEN_MINUTES_SECONDS) {
        store.delete(sessionId);
        ctr += 1;
      }
    }
    log(`[ReplayScreenshotStore] Cleaned up ${ctr} screenshot session(s).`);
  }, 10 * 60 * 1000);
}
