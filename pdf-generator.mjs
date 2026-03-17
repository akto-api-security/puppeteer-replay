/**
 * Generates report PDF in background. Updates ReportProgress on completion or failure.
 * Aligned with code-analysis src/libs/pdf/pdf.ts (logs, headers, API wait, styles, header template).
 */
import * as fs from 'fs';
import puppeteer from 'puppeteer';
import tmp from 'tmp';
import * as ReportProgress from './ReportProgress.mjs';

const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-features=Vulkan'
];

/** When reportUrl points at app.akto.io, use local dashboard container (e.g. in same docker-compose). */
const AKTO_APP_HOST = 'app.akto.io';
const LOCAL_DASHBOARD_BASE_URL = process.env.LOCAL_DASHBOARD_BASE_URL || 'http://akto-api-security-dashboard:8080';

/**
 * If reportUrl is from app.akto.io, rewrite to local dashboard URL so Puppeteer hits the local container.
 * @param {string} reportUrl
 * @returns {{ url: string, usedLocal: boolean }}
 */

function resolveReportUrl(reportUrl) {
  let url;
  try {
    url = new URL(reportUrl);
  } catch {
    return { url: reportUrl, usedLocal: false };
  }
  const hostname = (url.hostname || '').toLowerCase();
  if (hostname === AKTO_APP_HOST) {
    const base = LOCAL_DASHBOARD_BASE_URL.replace(/\/$/, '');
    const pathAndSearch = url.pathname + url.search;
    const localUrl = base + pathAndSearch;
    return { url: localUrl, usedLocal: true };
  }
  return { url: reportUrl, usedLocal: false };
}

function capitalizeFirstLetter(val) {
  if (!val) return val;
  return val.charAt(0).toUpperCase() + val.slice(1);
}

/**
 * @param {string} reportId
 * @param {{ username?: string, accessToken?: string, jsessionId?: string, organizationName?: string, reportDate?: string, reportUrl: string }} params
 * @param {{ (msg: string, key?: string) => void }} [log] - e.g. printAndAddLog from test.mjs; defaults to console.log
 */
export async function generatePDF(reportId, params, log = console.log) {
  const { reportUrl, accessToken, jsessionId, username = '', organizationName = '', reportDate = '' } = params || {};
  let browser = null;
  let tmpFile = null;
  const logPrefix = `[ReportId - ${reportId}]`;

  try {
    if (!reportUrl) {
      log(`${logPrefix} Missing reportUrl. Marking as FAILED.`, 'error');
      ReportProgress.setEntry(reportId, { status: 'FAILED', error: 'reportUrl is required' });
      return;
    }

    const { url: resolvedUrl, usedLocal } = resolveReportUrl(reportUrl);
    if (usedLocal) {
      log(`${logPrefix} Report URL is from ${AKTO_APP_HOST}; using local dashboard: ${resolvedUrl}`);
    }

    log(`${logPrefix} Generating PDF for report with following details: ${username}, ${organizationName}, ${reportDate}`);

    tmpFile = tmp.fileSync({ postfix: '.pdf', keep: true });
    browser = await puppeteer.launch({
      headless: 'new',
      dumpio: true,
      args: PUPPETEER_ARGS,
    });

    log(`${logPrefix} Setting up page.`);
    const page = await browser.newPage();

    const headers = {};
    if (accessToken) {
      headers['Access-Token'] = accessToken;
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (jsessionId) {
      headers['Cookie'] = `JSESSIONID=${jsessionId};`;
    }
    if (Object.keys(headers).length > 0) {
      await page.setExtraHTTPHeaders(headers);
    }

    const urlPath = new URL(resolvedUrl).pathname;
    let expectedApiName = null;
    if (urlPath.includes('dashboard/testing/summary')) {
      expectedApiName = 'fetchIssuesFromResultIds';
    } else if (urlPath.includes('dashboard/issues/summary')) {
      expectedApiName = 'fetchVulnerableTestingRunResultsFromIssues';
    } else if (urlPath.includes('dashboard/threat-detection/report')) {
      expectedApiName = 'fetchThreatTopNData';
    }

    // Attach API response listener *before* goto so we don't miss the request that runs on page load
    const API_WAIT_MS = 25000;
    const POST_API_DELAY_MS = 5000;
    let apiWaitPromise = null;
    if (expectedApiName) {
      log(`${logPrefix} Will wait for ${expectedApiName} API (listener attached before navigation).`);
      apiWaitPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          log(`${logPrefix} Timed out waiting for ${expectedApiName}. Will rely on DOM wait.`, 'error');
          resolve();
        }, API_WAIT_MS);
        const onResponse = async (response) => {
          const url = response.url();
          if (url.includes(expectedApiName)) {
            clearTimeout(timeout);
            page.off('response', onResponse);
            log(`${logPrefix} ${expectedApiName} resolved with status ${response.status()}. Waiting ${POST_API_DELAY_MS}ms for render.`);
            await new Promise((r) => setTimeout(r, POST_API_DELAY_MS));
            resolve();
          }
        };
        page.on('response', onResponse);
      });
    }

    log(`${logPrefix} Opening report url - ${resolvedUrl}.`);
    const response = await page.goto(resolvedUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    if (response && !response.ok()) {
      log(`${logPrefix} Navigation failed: ${response.status()} ${response.statusText()}`, 'error');
    }

    if (apiWaitPromise) {
      await apiWaitPromise;
    }

    // DOM-based wait: ensure report content (e.g. "Vulnerable APIs", charts) is visible before PDF
    log(`${logPrefix} Waiting for report content to render.`);
    try {
      await page.waitForFunction(
        () => {
          const body = document.body?.innerText || '';
          return (
            body.includes('Vulnerable APIs') ||
            body.includes('Report summary') ||
            body.includes('Issues by Severity') ||
            body.includes('Vulnerable issues')
          );
        },
        { timeout: 20000 }
      );
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      log(`${logPrefix} Report content wait timed out. Continuing with PDF.`, 'error');
    }

    await page.addStyleTag({
      content: `
        @page :first {
          margin-top: 0px;
        }
      `,
    });

    log(`${logPrefix} Applying styles to the report page.`);

    const evalPayload = {
      organizationNameText: capitalizeFirstLetter(organizationName),
      usernameSuffix: capitalizeFirstLetter((username || '').split('@')[0]),
    };
    await page.evaluate((payload) => {
      const reportContainer = document.getElementById('report-container');
      if (reportContainer) {
        reportContainer.style.margin = 'auto 0';
        reportContainer.style.height = 'auto';
      }
      const editorContainer = document.querySelectorAll('#sample-data-editor-container');
      if (editorContainer && editorContainer.length > 0) {
        editorContainer.forEach((element) => {
          element.style.border = '0.5px solid #0000001A';
        });
      }
      const affectedApiTableContainer = document.querySelectorAll('#affected-api-table-container');
      if (affectedApiTableContainer && affectedApiTableContainer.length > 0) {
        affectedApiTableContainer.forEach((element) => {
          element.style.border = '0.5px solid #0000001A';
        });
      }
      const editor = document.querySelectorAll('.editor');
      if (editor && editor.length > 0) {
        editor.forEach((element) => {
          element.style.borderTop = '0.5px solid #0000001A';
        });
      }
      const usernameWrapper = document.getElementById('second-line-wrapper');
      if (usernameWrapper) {
        usernameWrapper.innerText += payload.usernameSuffix;
      }
      const organizationNameEl = document.getElementById('organization-name');
      if (organizationNameEl) {
        organizationNameEl.innerText = payload.organizationNameText;
      }
    }, evalPayload);

    const headerTemplate = `
      <div style="-webkit-print-color-adjust: exact; background-color: #F6F6F7">
        <div style="font-size: 12px; width: 100vw; background-color: #1E3161; color: white; height: 100%; z-index: 2;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 64px;">
            <div>
              <h4 style="font-weight: 600">${capitalizeFirstLetter(organizationName)} API Security Findings</h4>
              <p style="font-weight: 400">${reportDate}</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const pdfOptions = {
      path: tmpFile.name,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      margin: { top: '90px' },
    };

    await page.pdf(pdfOptions);
    log(`${logPrefix} Report downloaded.`);

    ReportProgress.setEntry(reportId, { status: 'COMPLETED', reportTmpFile: tmpFile });
  } catch (err) {
    if (tmpFile && typeof tmpFile.removeCallback === 'function') {
      try {
        tmpFile.removeCallback();
      } catch (e) {}
    }
    const errorMessage = err?.message ?? String(err);
    log(`${logPrefix} An error occurred: ${errorMessage}`, 'error');
    ReportProgress.setEntry(reportId, { status: 'FAILED', error: errorMessage });
  } finally {
    if (browser) {
      log(`${logPrefix} Closing puppeteer browser.`);
      try {
        await browser.close();
      } catch (e) {}
      log(`${logPrefix} Puppeteer browser has been closed.`);
    }
  }
}

const SAMPLE_PDF_URL = 'https://httpbin.org/html';

/**
 * Generate a sample PDF from a URL. Matches code-analysis samplePdf.ts.
 * @param {string} [targetUrl] - URL to capture as PDF; defaults to https://httpbin.org/html
 * @returns {{ status: 'COMPLETED', base64PDF: string }} or throws
 */
export async function generateSamplePDF(targetUrl = SAMPLE_PDF_URL) {
  let browser = null;
  let tmpFile = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      dumpio: true,
      args: PUPPETEER_ARGS,
    });
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    tmpFile = tmp.fileSync({ postfix: '.pdf', keep: true });
    await page.pdf({
      path: tmpFile.name,
      printBackground: true,
      displayHeaderFooter: true,
      margin: { top: '90px' },
    });

    const pdfBuffer = fs.readFileSync(tmpFile.name);
    const base64PDF = pdfBuffer.toString('base64');
    return { status: 'COMPLETED', base64PDF };
  } finally {
    if (tmpFile && typeof tmpFile.removeCallback === 'function') {
      try {
        tmpFile.removeCallback();
      } catch (e) {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}
