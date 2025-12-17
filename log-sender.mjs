async function sendLogToBackend(log, key) {
  try {
    const apiKey = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJBa3RvIiwic3ViIjoiaW52aXRlX3VzZXIiLCJhY2NvdW50SWQiOjE2NjI2ODA0NjMsImlhdCI6MTc2NTk3NzI1OCwiZXhwIjoxNzgxNzAyMDU4fQ.TzmKovqONWH9ijgGICFjZATuGkEYTikmmQHkRimfu_wIs94IPhue8TfEDt74DklbM6296YorbyLtvIJeGCLF-DcsBbDATpC-kDZNoEkbFtP1DBXaltJKziqLB_ejtGg1xCNcbYP11OB-Kh7EzLN_kSZ6b4RYew0HlRDaF-sPmKOGgnbumLUERhWz5yy2Bru1Lw1lCTxfWWY9BtjlUcgBj0EASYFWoKv14jmcSZtgCrC_Y3GqwhIKmTplt-kU9H8eGEINj6ylcJtWod-ssU5b2ciXz0UIrdbJPvQfxD9xK4N7jep7UXyQy9y7mxXQwUJYzGInolsCieeRxCwSELXRhA";
    // if (!apiKey) {
    //   return;
    // }

    await fetch('https://cyborg.akto.io/api/insertPuppeteerLog', {
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
