import { createRunner, PuppeteerRunnerExtension } from '@puppeteer/replay';
import puppeteer from 'puppeteer';

import * as http from 'http';
import MongoQueue, { connectionString } from './mongo_queue.mjs';
import generateTOTP from './topt-gen.mjs';
import sendLogToBackend from './log-sender.mjs';

const port = process.env.PORT || 3000;

let mongoQueue = null;
let shouldSendToBackend = false; // Flag to track if request contains "axating"

function printAndAddLog(log, key = "info", shouldSave = true) {
  console.log(log);

  // Send to backend if the input request contains "axating"
  if (shouldSendToBackend) {
    sendLogToBackend(log, key).catch((err) => {
      console.error('Failed to send log to backend:', err);
    });
  }

  if (shouldSave && mongoQueue) {
    mongoQueue.addLogToQueue({
      log,
      timestamp: parseInt(new Date().getTime()/1000),
      key
  }).then(() => {
    // do nothing

    }).catch((err) => {
      console.error(err)
    });
  }
}

function stringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    return err.message || "Could not stringify object"; 
  }
}

async function runReplay(replayJSON, command) {  
  let browser = null;
  try {
    var body = replayJSON
    var bodyObj = JSON.parse(body);
    const secretKey = bodyObj?.secretKey;
    const customHeaders = bodyObj?.headers || {};

    printAndAddLog("parsed body: " + body)

    browser = await puppeteer.launch({
      headless: 'new', // Use new headless mode which is less detectable
      dumpio: true,
      args: [
        '--no-sandbox', '--disable-gpu', '--disable-setuid-sandbox',  '--disable-features=ServiceWorker',     '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--allow-running-insecure-content'

      ]
    });

    const wsEndpoint = browser.wsEndpoint();
    console.log('Puppeteer WS Endpoint URL:', wsEndpoint);
    
    printAndAddLog("browser launched: " + body, "info", false)

    const tokenMap = {};
    const page = await browser.newPage();
    printAndAddLog("new page started: " + page, "info", false)

    // Additional anti-detection measures
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // *** CHANGED: set default timeouts so waits fail instead of hanging ***
    page.setDefaultNavigationTimeout(200000);
    page.setDefaultTimeout(30000);

    // Apply custom headers if present in the recording
    if (customHeaders && Object.keys(customHeaders).length > 0) {
      try {
        printAndAddLog(`Applying custom headers: ${stringify(customHeaders)}`);
        await page.setExtraHTTPHeaders(customHeaders);
        printAndAddLog("Custom headers applied successfully");
      } catch (headerError) {
        printAndAddLog(`Warning: Failed to apply custom headers: ${stringify(headerError)}`, "error");
        // Non-fatal: continue execution even if header application fails
      }
    }

const cdp = await page.target().createCDPSession();

await cdp.send('Fetch.enable', {
  patterns: [
    { urlPattern: '*axating*/oauth/token*' }
  ],
});


async function setTokenInLocalStorage(token) {
  await page.evaluate((t) => {
    localStorage.setItem('authTokenHeader', t);
  }, token);
}


async function fulfillBrowserToken(requestId, body) {
  await cdp.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: 'content-type', value: 'application/json' },
    ],
    body: Buffer.from(body).toString('base64'),
  });
}


cdp.on('Fetch.requestPaused', async (evt) => {
  const { requestId, request } = evt;

  if (!request.url.includes('/oauth/token') || request.method !== 'POST') {
    await cdp.send('Fetch.continueRequest', { requestId });
    return;
  }

  console.log('[MITM token]');

  // 1️⃣ BLOCK browser request
//  await cdp.send('Fetch.failRequest', {
//    requestId,
//    errorReason: 'BlockedByClient',
//  });

  // 2️⃣ Clone headers safely
  const headers = {};
  for (const [k, v] of Object.entries(request.headers)) {
    const lk = k.toLowerCase();
    if (['host', 'content-length', 'origin', 'referer'].includes(lk)) continue;
    headers[k] = v;
  }

  // 3️⃣ Manual fetch (exact same body)
  try {
    const res = await fetch(request.url, {
      method: 'POST',
      headers,
      body: request.postData,
    });

      console.log('[token]', request.method, request.url);
      console.log('headers:', headers);
      console.log('postData:', request.postData);


    const text = await res.text();
    console.log('[MANUAL token]', res.status, text);



    const json = JSON.parse(text);
    const accessToken = json.access_token;

    if (!accessToken) {
      console.error('[TOKEN] access_token missing', json);
      return;
    }

    console.log('[TOKEN] extracted');

    // 4️⃣ Store token in localStorage
    await setTokenInLocalStorage(accessToken);


    //(Optional) inject response back into browser
    await fulfillBrowserToken(requestId, text);

  } catch (err) {
    console.error('[MANUAL token failed]', err);
  }
});



    // Override webdriver property
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override chrome property
      window.navigator.chrome = {
        runtime: {},
      };

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });

    var output = "{}";
    let requestInterceptionSetup = false;
    let extractorList = []; // Store extractors outside handler
    let requestHandlerRegistered = false;
    let responseHandlerRegistered = false;
    
    class Extension extends PuppeteerRunnerExtension {
      async beforeEachStep(step, flow) {
        try {
          if (secretKey?.length > 0 && step.type === "change") {
            const allSelectors = step.selectors?.flat() ?? [];

            if (allSelectors.some(sel => sel.includes("autoAdvanceInput"))) {
              const totpCode = generateTOTP(secretKey);

              const ariaSel = allSelectors.find(sel => sel.startsWith("aria/code"));
              let index = 0;
              if (ariaSel) {
                const match = ariaSel.match(/aria\/code (\d+)/);
                if (match) index = parseInt(match[1], 10);
              }

              step.value = totpCode[index];
              printAndAddLog(`TOTP: filling digit ${index} with ${step.value}`);
            } else if (allSelectors.some(sel =>
              sel.toLowerCase().includes("verification code") ||
              sel.toLowerCase().includes("totp") ||
              sel.toLowerCase().includes("authenticator")
            )) {
              const totpCode = generateTOTP(secretKey);
              step.value = totpCode;

              printAndAddLog(`TOTP: filling full OTP ${step.value}`);
            }
          }
        } catch (error) {
          printAndAddLog("Error while filling TOTP: " + error, "error")
        }

        
        printAndAddLog("step: " + stringify(step) + " " + (typeof step) + " " + +Date.now())
        if (step.requests) {
          // Update extractor list for current step
          extractorList = step.requests;

          // Setup request interception only once
          if (!requestInterceptionSetup) {
            await page.setRequestInterception(true);
            requestInterceptionSetup = true;
          }

          // Register request handler only once
          if (!requestHandlerRegistered) {
            printAndAddLog("requestHandlerRegistered: " + requestHandlerRegistered)
            page.on("request", async (request) => {
              try {
                // If statement to catch XHR requests and Ignore XHR requests to Google Analytics
                printAndAddLog("request.method(): " + request.method() + " " + request.url())
                if ((request.resourceType() === "xhr" || request.resourceType() === "fetch") && request.method() !== "OPTIONS") {
                  // Process extractors sequentially to avoid race conditions
                  for (const ex of extractorList) {
                    try {
                      if (new RegExp(ex.urlRegex).test(request.url())) {
                        printAndAddLog("url matches: " + request.url())
                        switch (ex.position) {
                          case "header": 
                            printAndAddLog("kv pair: " + ex.saveAs + " " + stringify(request.headers()))
                            let headerVal = request.headers()[ex.name]
                            if (!!headerVal) {
                              let command = "localStorage.setItem(\""+ ex.saveAs + "\", \"" + headerVal + "\");";
                              printAndAddLog("command: " + command)
                              await page.evaluate((x) => eval(x), command)
                            }
                            break;
                          case "payload":
                            if (!request.postData() || request.postData().length === 0) 
                              break;
                            let kvPairsStr = request.postData().split("&")
                            for (let index = 0; index < kvPairsStr.length; index++) {
                              const kvStr = kvPairsStr[index];
                              const [key, value] = kvStr.split("=");
                              printAndAddLog("key, value pair: " + key + " " + value)
                              if (key === ex.name && !!value) {
                                let command = "localStorage.setItem(\""+ ex.saveAs + "\", \"" + value + "\");";
                                printAndAddLog("command: " + command)
                                await page.evaluate((x) => eval(x), command)
                              }
                            }
                            break;
                          case "query": 
                            let queryParams = request.url().split("?")
                            if (queryParams.length < 2) break;

                            let querykvPairsStr = queryParams[1].split("&")
                            for (let index = 0; index < querykvPairsStr.length; index++) {
                              const kvStr = querykvPairsStr[index];
                              const [key, value] = kvStr.split("=");
                              printAndAddLog("key, value pair: " + key + " " + value)  
                              if (key === ex.name && !!value) {
                                let command = "localStorage.setItem(\""+ ex.saveAs + "\", \"" + value + "\");";
                                printAndAddLog("command: " + command)
                                await page.evaluate((x) => eval(x), command)
                              }
                            }
                            break;
                        }
                      }
                    } catch (exError) {
                      printAndAddLog("Error processing extractor: " + stringify(exError), "error");
                    }
                  }
                }
              } catch (error) {
                printAndAddLog("Error in request handler: " + stringify(error), "error");
              } finally {
                // Always continue the request, even if there was an error
                try {
                  request.continue();
                } catch (continueError) {
                  printAndAddLog("Error continuing request: " + stringify(continueError), "error");
                }
              }
            });
            requestHandlerRegistered = true;
          }

          // Register response handler only once
          if (!responseHandlerRegistered) {
            printAndAddLog("responseHandlerRegistered: " + responseHandlerRegistered)
            page.on("response", (response) => {
              try {
                const request = response.request();
                if (request.resourceType() === "xhr" && request.method() === "OPTIONS") {
                  printAndAddLog("Response Body: " + request.method() + " " + request.url())
                }
              } catch (error) {
                printAndAddLog("Error in response handler: " + stringify(error), "error");
              }
            });
            responseHandlerRegistered = true;
          }
          
        }

        // Wait for page to be ready after navigation
        if (step.type === "navigate") {
          try {
            await page.waitForFunction(
              () => document.readyState === 'complete' || document.readyState === 'interactive',
              { timeout: 30000 }
            ).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 1000));
            await page.waitForNetworkIdle?.({ timeout: 10000, idleTime: 500 }).catch(() => {});
          } catch (err) {
            printAndAddLog("Navigation wait error (non-fatal): " + stringify(err));
          }
        }

        switch(step.type){
          case "click":
          case "change":
            // Wait for element to be ready
            if (step.selectors && step.selectors.length > 0) {
              const allSelectors = step.selectors.flat();
              let elementFound = false;
              for (const selector of allSelectors) {
                try {
                  if (selector.startsWith("xpath//") || selector.startsWith("pierce/")) continue;
                  let cleanSelector = selector.startsWith("aria/") 
                    ? `[aria-label*="${selector.replace("aria/", "").trim()}"]`
                    : selector;
                  await page.waitForSelector(cleanSelector, { timeout: Math.min(step.timeout || 30000, 10000), visible: true });
                  elementFound = true;
                  break;
                } catch (err) {
                  continue;
                }
              }
              if (!elementFound && step?.waitForSelector?.length > 0) {
                printAndAddLog("waiting for selector: " + step.waitForSelector)
                try {
                  await page.waitForSelector(step.waitForSelector, {timeout: step.timeout || 30000});
                } catch (error) {
                  printAndAddLog("Error in waitForSelector: " + stringify(error), "error")
                }
              }
            } else if (step?.waitForSelector?.length > 0) {
              printAndAddLog("waiting for selector: " + step.waitForSelector)
              try {
                await page.waitForSelector(step.waitForSelector, {timeout: step.timeout || 30000});
              } catch (error) {
                printAndAddLog("Error in waitForSelector: " + stringify(error), "error")
              }
            }
            // Small delay for DOM stability
            await new Promise(resolve => setTimeout(resolve, 100));
            
            if(step?.checkSelector !== undefined){
              let element = null
              try {
                printAndAddLog("step.selectors: " + stringify(step.selectors))
                let ansElem = step.selectors[0][0];
                let quesElem = ansElem.replaceAll("tbxKBA", "lblKBQ");
                printAndAddLog("questionElemSelector: " + quesElem)
                element = await page.$(quesElem);
                printAndAddLog("questionElem: " + element)
                const answer = await page.evaluate(el => {
                  const text = el.textContent.trim();
                  const words = text.replace(/[?.,!]*$/, '').split(' ');
                  return words[words.length - 1];
                }, element);

                step.value = answer
                printAndAddLog("step value answer: " + answer)
                element = await page.$(ansElem);
              } catch (error) {
                element = null
              }

              

              printAndAddLog("element: " + stringify(element))
              if(!element){
                step.type = "click"
                step.selectors =  [
                      [
                          "#lblTop"
                      ]
                  ]
                  ,
                  step.offsetY = 10
                  step.offsetX = 146                
                return;
              }
            }
            break;
          default:
            
            break;
        }
        try {
          await page.screenshot({ path:"ss_"+(+Date.now())+".jpg"});
        } catch (err) {
          printAndAddLog("Error taking screenshot: " + stringify(err), "error");
        }

        await super.beforeEachStep(step, flow);

        // Print current page URL
        try {
          const currentUrl = await page.url();
          printAndAddLog(`Current URL: ${currentUrl}`);
        } catch (err) {
          printAndAddLog(`Error getting current URL: ${err}`, "error");
        }
      }

      async afterEachStep(step, flow) {
        await super.afterEachStep(step, flow);
    
        // Wait for network to settle after click/change actions
        if (step.type === "click" || step.type === "change") {
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            await page.waitForNetworkIdle({ timeout: 5000, idleTime: 500 }).catch(() => {});
          } catch (err) {
            printAndAddLog("Network idle wait error (non-fatal): " + stringify(err), "error");
          }
        }
    
        let pages = await browser.pages()
        pages.forEach(_page => {
          _page.on("response", async resp => {
            var headers = resp.headers()
            for (let key in headers) {
              if (key === 'set-cookie') {
                var tokenObj = headers[key].split(';')[0]
                var tokenKey = tokenObj.split('=')[0]
                var tokenVal = tokenObj.split('=')[1]
                tokenMap[tokenKey] = tokenVal
              }
            }
    
          })
          
          
        })
        printAndAddLog("after step: " + +Date.now())
      }
    
      async afterAllSteps(flow) {
        await super.afterAllSteps(flow);
        
        try {
          const href = await page.evaluate(() =>  window.location.href);
          await page.waitForNetworkIdle({ timeout: 30000 });
        } catch (err) {
          printAndAddLog("error in waitForNetworkIdle: " + stringify(err), "error")
        } 

        page.evaluate((x) => cookieMap = x, tokenMap);

        printAndAddLog("command: " + command)
        const cookies = await page.cookies()
        const formattedCookies = cookies.map((cookie, index) => ({
          domain: cookie.domain,
          expirationDate: cookie.expires,
          hostOnly: !cookie.domain.startsWith('.'),
          httpOnly: cookie.httpOnly,
          name: cookie.name,
          path: cookie.path,
          sameSite: cookie.sameSite ? cookie.sameSite.toLowerCase() : 'unspecified',
          secure: cookie.secure,
          session: cookie.session || false,
          storeId: '0',
          value: cookie.value,
          id: index + 1
        }));
    
        const localStorageValues = await page.evaluate((x) => eval(x), command);
        const aktoOutput = await page.evaluate((x) => eval(x), "JSON.parse(JSON.stringify(localStorage));");
        var token = String(localStorageValues)
        printAndAddLog("tokenMap: " + stringify(tokenMap))
        var createdAt = Math.floor(Date.now()/1000)
        var outputObj = {'token': token, "created_at": createdAt, "aktoOutput": aktoOutput, 'all_cookies': formattedCookies}

        output = stringify(outputObj)
      }
    }

    const ext = new Extension(browser, page, 200000)

    printAndAddLog("runner.run starting", "info", false);
    const runner = await createRunner(
      bodyObj,
      ext
    );

    const startTs = Date.now();

    // hard timeout so we do not hang forever
    const maxRunMs = 300000; // 5 minutes
    try {
      printAndAddLog("runner started: ", "info", false)
      await Promise.race([
        runner.run(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("runner.run timeout after " + maxRunMs + " ms")), maxRunMs)
        ),
      ]);
      printAndAddLog("runner.run finished in " + (Date.now() - startTs) + " ms", "info", false);
    } catch (e) {
      printAndAddLog("runner.run error or timeout: " + stringify(e), "error");
      // rethrow so caller sees failure
      try {
        await page.screenshot({ path: "/tmp/final_timeout_" + (+Date.now()) + ".png", fullPage: true });
        printAndAddLog("Saved final timeout screenshot", "error");
      } catch (ssErr) {
        printAndAddLog("Error saving final timeout screenshot: " + stringify(ssErr), "error");
      }
      throw e;
    }

    return output;
  } catch (error) {
    printAndAddLog("Error in runReplay: " + stringify(error), "error");
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
        printAndAddLog("Browser closed successfully", "info", false);
      } catch (closeError) {
        printAndAddLog("Error closing browser: " + stringify(closeError), "error");
      }
    }
  }
}




// const path = '/Users/ankushjain/Downloads/insperity-3 (1).json';

// fs.readFile(path, 'utf8', (err, data) => {
//   if (err) {
//     console.error('Error reading the file:', err);
//     return;
//   }
//   try {
//     runReplay(data, "Object.entries(cookieMap).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('; ');")
//     .then(x => {
//       console.log(x)
//     })
    
//   } catch (parseErr) {
//     console.error('Error parsing JSON:', parseErr);
//   }
// });




const server = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
        var body = '';
    }

    req.on('data', function (data) {
        body += data;
    });

    req.on('end', async function () {
      try {
        // Check if the incoming request contains "axating" or if SEND_LOGS env var is set to true
        shouldSendToBackend = body.includes("axating") || process.env.SEND_LOGS === 'true';

        let dataObj = JSON.parse(body)
        printAndAddLog("dataObj: " + stringify(dataObj))
        const msg = await runReplay(dataObj.replayJson, dataObj.command);
        res.writeHead(200, {'Content-Type': 'application/json'});
        if (mongoQueue) {
          mongoQueue.flushRemaining();
        }
        res.end(msg);
      } catch (err) {
        printAndAddLog("error: " + err, "error")
        res.writeHead(400, {"Content-type": "text/plain"});
        res.end("Bad request")
      } finally {
        // Reset the flag after processing the request
        shouldSendToBackend = false;
      }
    });
});

try {
  if (connectionString != null
    && connectionString != undefined
    && connectionString !== ''
    && connectionString.length > 0
    && connectionString !== 'undefined'
  ) {
    mongoQueue = new MongoQueue();
    await mongoQueue.connect();
  }
} catch (err) {
  console.error(err)
}

server.listen(port, () => {
  printAndAddLog(`server running on http://localhost:${port}/`, "info", false)
});


