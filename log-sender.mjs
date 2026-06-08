async function sendLogToBackend(log, key) {
  try {
    const apiKey = process.env.LOG_SENDER_API_KEY;
    if (!apiKey) return;

    const domain = process.env.LOG_SENDER_DOMAIN || 'https://ultron.akto.io';
    await fetch(`${domain}/api/insertPuppeteerLog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey  // Database abstractor token
      },
      body: JSON.stringify({
        log: {
          log: log,
          key: key,
          timestamp: Math.floor(Date.now() / 1000)  // Unix timestamp in seconds
        }
      })
    });
  } catch (err) {
    console.error('Error sending log to backend:', err);
  }
}

export default sendLogToBackend;
