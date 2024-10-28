import { createRunner, PuppeteerRunnerExtension } from '@puppeteer/replay';
import puppeteer from 'puppeteer';

import fs from 'fs'

import * as http from 'http';

const port = process.env.PORT || 3000;

async function runReplay(replayJSON, command) {  
  var body = replayJSON
  
  var bodyObj = JSON.parse(body);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });
  const tokenMap = {};
  
  const page = await browser.newPage();
  const ua =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
  await page.setUserAgent(ua);
  
  page.setDefaultNavigationTimeout(100000);
  var output = "{}";
  class Extension extends PuppeteerRunnerExtension {
    async beforeEachStep(step, flow) {
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
    }
  
    async afterAllSteps(flow) {
      await super.afterAllSteps(flow);
      
      await page.waitForNavigation({waitUntil: 'networkidle0'})
      
      const href = await page.evaluate(() =>  window.location.href);
  
      console.log(tokenMap)

      page.evaluate((x) => cookieMap = x, tokenMap);

      console.log("command")

      console.log(command)
  
      const localStorageValues = await page.evaluate((x) => eval(x), command);
  
      console.log(localStorageValues)

      var token = String(localStorageValues)
      var createdAt = Math.floor(Date.now()/1000)
      output = `{"token": "${token}", "created_at": ${createdAt}}`
    
      await browser.close();
    }
  }
    
  const runner = await createRunner(
    bodyObj,
    new Extension(browser, page, 7000)
  );
  
  await runner.run();
  

  return output;
}


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
        // console.log(dataObj);
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


