import { createRunner, PuppeteerRunnerExtension } from '@puppeteer/replay';
import puppeteer from 'puppeteer';

import fs from 'fs'

import * as http from 'http';

const port = process.env.PORT || 3000;
const debugMode = process.env.DEBUG_MODE === "true"

async function runReplay(replayJSON, command) {  
  var body = replayJSON
  
  var bodyObj = JSON.parse(body);
  
  console.log("parsed body: ", bodyObj)

  const browser = await puppeteer.launch({
    headless: true,
    dumpio: true,
    args: ['--no-sandbox', "--disable-gpu"]
  });
  
  console.log("browser launched: ", bodyObj)

  const tokenMap = {};
  
  const page = await browser.newPage();
  await page.setRequestInterception(true);

  console.log("new page started: ", page)

  page.setDefaultNavigationTimeout(200000);
  var output = "{}";
  class Extension extends PuppeteerRunnerExtension {
    async beforeEachStep(step, flow) {
      console.log("step", step, typeof step, +Date.now())
      if (step.requests) {
        let extractorList = step.requests

        page.on("request", (request) => {
          // If statement to catch XHR requests and Ignore XHR requests to Google Analytics
          console.log ("request.method(): ", request.method(), request.url())
          if (request.resourceType() === "xhr" && request.method() !== "OPTIONS") {
            // Capture some XHR request data and log it to the console
            extractorList.forEach(async (ex) => {
              if (new RegExp(ex.urlRegex).test(request.url())) {
                console.log("url matches: ", request.url())
                switch (ex.position) {
                  case "header": 
                    console.log("kv pair: ", ex.saveAs, JSON.stringify(request.headers()))
                    let headerVal = request.headers()[ex.name]
                    if (!!headerVal) {
                      let command = "localStorage.setItem(\""+ ex.saveAs + "\", \"" + headerVal + "\");";
                      console.log("command: ", command)
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
                      console.log("key, value pair: ", key, value)

                      if (key === ex.name && !!value) {
                        let command = "localStorage.setItem(\""+ ex.saveAs + "\", \"" + value + "\");";
                        console.log("command: ", command)
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
                      console.log("key, value pair: ", key, value)

                      if (key === ex.name && !!value) {
                        let command = "localStorage.setItem(\""+ ex.saveAs + "\", \"" + value + "\");";
                        console.log("command: ", command)
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
            console.log("Response Body", request.method(), request.url());
          }
        })
      }

      switch(step.type){
        case "click":
        case "change":
          if(step?.checkSelector !== undefined){
            let element = null
            try {
              console.log("step.selectors: ", step.selectors)
              let ansElem = step.selectors[0][0];
              let quesElem = ansElem.replaceAll("tbxKBA", "lblKBQ");
              console.log("questionElemSelector: ", quesElem)

              element = await page.$(quesElem);
              console.log("questionElem: ", element)
              const answer = await page.evaluate(el => {
                const text = el.textContent.trim();
                const words = text.replace(/[?.,!]*$/, '').split(' ');
                return words[words.length - 1];
              }, element);

              step.value = answer
              console.log("step value answer: ", answer)
              element = await page.$(ansElem);
            } catch (error) {
              element = null
            }

            

            console.log("element", element)
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
      await page.screenshot();
      await super.beforeEachStep(step, flow);
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

      if(debugMode){
        try {
            const timestamp = Date.now();
            const screenshotPath = `step-${step?.value || 'unknown'}-${timestamp}.png`
            await page.screenshot({
              path: screenshotPath,
            });
            await pages[0].screenshot({ path: screenshotPath });
            console.log(`Screenshot saved: ${screenshotPath}`);
        } catch (error) {
            console.error('Error capturing screenshot:', error);
        }
      }
      console.log("after step: ", +Date.now())
    }
  
    async afterAllSteps(flow) {
      await super.afterAllSteps(flow);
      
      try {
        const href = await page.evaluate(() =>  window.location.href);
        await page.waitForNetworkIdle()
      } catch (err) {
        console.log("error in waitForNetworkIdle: ", err)
      } 

      page.evaluate((x) => cookieMap = x, tokenMap);

//      console.log(cookieMap)

      console.log("command")

      console.log(command)
  
      const localStorageValues = await page.evaluate((x) => eval(x), command);
      const aktoOutput = await page.evaluate((x) => eval(x), "JSON.parse(JSON.stringify(localStorage));");
      var token = String(localStorageValues)
      // console.log("cookieMap: ", cookieMap)
      console.log("tokenMap: ", tokenMap)
      var createdAt = Math.floor(Date.now()/1000)
      var outputObj = {'token': token, "created_at": createdAt, "aktoOutput": aktoOutput}

      output = JSON.stringify(outputObj)
      await browser.close();
    }
  }
    
  const runner = await createRunner(
    bodyObj,
    new Extension(browser, page, 200000)
  );
  
  await runner.run();
  console.log("runner started: ")


  return output;
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
        console.log(dataObj);
        const msg = await runReplay(dataObj.replayJson, dataObj.command);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(msg);
      } catch (err) {
        console.log(err)
        res.writeHead(400, {"Content-type": "text/plain"});
        res.end("Bad request")
      }    
    });
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}/`);
});



