/**
 * Generates report PDF in background. Updates ReportProgress on completion or failure.
 */
import puppeteer from 'puppeteer';
import tmp from 'tmp';
import * as ReportProgress from './ReportProgress.mjs';

const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-setuid-sandbox',
  '--disable-features=ServiceWorker',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--allow-running-insecure-content',
];

/**
 * @param {string} reportId
 * @param {{ username?: string, accessToken?: string, jsessionId?: string, organizationName?: string, reportDate?: string, reportUrl: string }} params
 */
export async function generatePDF(reportId, params) {
  const { reportUrl, accessToken, jsessionId } = params || {};
  let browser = null;
  let tmpFile = null;
  try {
    if (!reportUrl) {
      ReportProgress.setEntry(reportId, { status: 'FAILED' });
      return;
    }
    tmpFile = tmp.fileSync({ postfix: '.pdf', keep: true });
    browser = await puppeteer.launch({
      headless: 'new',
      dumpio: true,
      args: PUPPETEER_ARGS,
    });
    const page = await browser.newPage();
    const headers = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (jsessionId) {
      headers['Cookie'] = `JSESSIONID=${jsessionId}`;
    }
    if (Object.keys(headers).length > 0) {
      await page.setExtraHTTPHeaders(headers);
    }
    await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.pdf({ path: tmpFile.name, format: 'A4', printBackground: true });
    ReportProgress.setEntry(reportId, { status: 'COMPLETED', reportTmpFile: tmpFile });
  } catch (err) {
    if (tmpFile && typeof tmpFile.removeCallback === 'function') {
      try {
        tmpFile.removeCallback();
      } catch (e) {}
    }
    ReportProgress.setEntry(reportId, { status: 'ERROR' });
    console.error('[generatePDF]', reportId, err);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

const SAMPLE_PDF_URL = 'https://httpbin.org/html';

/**
 * Generate a sample PDF from a fixed URL. Returns { status: 'COMPLETED', base64PDF } or throws.
 */
export async function generateSamplePDF() {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      dumpio: true,
      args: PUPPETEER_ARGS,
    });
    const page = await browser.newPage();
    await page.goto(SAMPLE_PDF_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    const base64PDF = Buffer.from(pdfBuffer).toString('base64');
    return { status: 'COMPLETED', base64PDF };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}
