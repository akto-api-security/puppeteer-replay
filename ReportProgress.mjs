/**
 * Progress store for report PDF generation. Same reportId can be polled.
 * Cleanup runs every 10 minutes: remove entries older than 10 minutes
 * and call reportTmpFile.removeCallback() if present.
 */

const progressMap = new Map();

const TEN_MINUTES_SECONDS = 10 * 60;

function getUnixTimestampInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function getEntry(reportId) {
  return progressMap.get(reportId);
}

export function setEntry(reportId, entry) {
  progressMap.set(reportId, { ...entry, updatedAt: getUnixTimestampInSeconds() });
}

export function startCleanupInterval() {
  setInterval(() => {
    const now = getUnixTimestampInSeconds();
    for (const [reportId, entry] of progressMap.entries()) {
      if (now - entry.updatedAt > TEN_MINUTES_SECONDS) {
        if (entry.reportTmpFile && typeof entry.reportTmpFile.removeCallback === 'function') {
          try {
            entry.reportTmpFile.removeCallback();
          } catch (e) {
            // ignore
          }
        }
        progressMap.delete(reportId);
      }
    }
  }, 10 * 60 * 1000); // every 10 minutes
}

export { getUnixTimestampInSeconds };
