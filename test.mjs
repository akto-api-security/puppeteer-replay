import { createRunner, PuppeteerRunnerExtension } from '@puppeteer/replay';
import puppeteer from 'puppeteer';

import fs from 'fs'

import * as http from 'http';

const port = process.env.PORT || 3000;

async function runReplay(replayJSON, command) {  
  var body = replayJSON
  
  var bodyObj = JSON.parse(body);
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox']
  });
  
  const tokenMap = {};
  
  const page = await browser.newPage();
  
  page.setDefaultNavigationTimeout(20000);
  var output = "{}";
  class Extension extends PuppeteerRunnerExtension {
    async beforeEachStep(step, flow) {
      console.log("step", step, typeof step)
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
      
      
      const href = await page.evaluate(() =>  window.location.href);
  
      page.evaluate((x) => cookieMap = x, tokenMap);
  
      const localStorageValues = await page.evaluate((x) => eval(x), command);
  
      var token = String(localStorageValues)
      // console.log("cookieMap: ", cookieMap)
      console.log("tokenMap: ", tokenMap)
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



