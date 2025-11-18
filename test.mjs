import { createRunner, PuppeteerRunnerExtension } from '@puppeteer/replay';
import puppeteer from 'puppeteer';

import fs from 'fs'

import * as http from 'http';
import MongoQueue from './mongo_queue.mjs';
import generateTOTP from './topt-gen.mjs';

const port = process.env.PORT || 3000;

let mongoQueue = null;

function printAndAddLog(log, key = "info", shouldSave = true) {
  console.log(log);
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
    
    printAndAddLog("parsed body: " + body)

    browser = await puppeteer.launch({
      headless: 'new', // Use new headless mode which is less detectable
      dumpio: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update'
      ]
    });
    
    printAndAddLog("browser launched: " + body, "info", false)

    const tokenMap = {};
    const page = await browser.newPage();
    printAndAddLog("new page started: " + page, "info", false)

    // Additional anti-detection measures
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    page.setDefaultNavigationTimeout(200000);
    page.setDefaultTimeout(30000);
    
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

    page.setDefaultNavigationTimeout(200000);
    var output = "{}";
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
          let extractorList = step.requests

          page.on("request", (request) => {
            // If statement to catch XHR requests and Ignore XHR requests to Google Analytics
            printAndAddLog("request.method(): " + request.method() + " " + request.url())
            if ((request.resourceType() === "xhr" || request.resourceType() === "fetch") && request.method() !== "OPTIONS") {
              // Capture some XHR request data and log it to the console
              extractorList.forEach(async (ex) => {
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
                      if (!request.postData() || request.postData().length == 0) 
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
              })
              // console.log("XHR Request", request.method(), request.url());
              // console.log("Headers", request.headers());
              // console.log("Post Data", request.postData());
            }
        
            // Allow the request to be sent
            request.continue();
          })

          page.on("response", (response) => {
            const request = response.request();
            if (request.resourceType() === "xhr" && request.method() === "OPTIONS") {
              printAndAddLog("Response Body: " + request.method() + " " + request.url())
            }
          })

          await page.setRequestInterception(true);
          
        }

        switch(step.type){
          case "click":
          case "change":
            if (step?.waitForSelector?.length > 0) {
              printAndAddLog("waiting for selector: " + step.waitForSelector)
              try {
                await page.waitForSelector(step.waitForSelector, {timeout: step.timeout || 30000});
              } catch (error) {
                printAndAddLog("Error in waitForSelector: " + stringify(error), "error")
              }
            }
            
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
        await page.screenshot({path:"ss_"+(+Date.now())+".jpg"});
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
          await page.waitForNetworkIdle()
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
      
    const runner = await createRunner(
      bodyObj,
      new Extension(browser, page, 200000)
    );
    
    await runner.run();
    printAndAddLog("runner started: ", "info", false)

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
      }    
    });
});

try {
  mongoQueue = new MongoQueue();
  await mongoQueue.connect();
} catch (err) {
  console.error(err)
}

server.listen(port, () => {
  printAndAddLog(`server running on http://localhost:${port}/`, "info", false)
});


