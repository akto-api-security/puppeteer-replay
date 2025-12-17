async function sendLogToBackend(log, key) {
  try {
    const apiKey = process.env.AKTO_API_KEY;
    if (!apiKey) {
      console.error('AKTO_API_KEY environment variable is not set');
      return;
    }

    await fetch('http://localhost:82/api/insertPuppeteerLog', {
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
