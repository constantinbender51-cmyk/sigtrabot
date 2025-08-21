// webServer.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

const PORT = process.env.PORT || 3000;
const metricsFile = path.join(process.cwd(), 'logs', 'metrics.ndjson');
const humanLog    = path.join(process.cwd(), 'logs', 'trading-bot.log');

export function startWebServer() {
  const app = express();

  /* ---------- 1. PERFORMANCE DASHBOARD ( / ) ---------- */
  app.get('/', (req, res) => {
    let metrics = [];
    if (fs.existsSync(metricsFile)) {
      metrics = fs.readFileSync(metricsFile, 'utf8')
                   .split('\n')
                   .filter(Boolean)
                   .map(JSON.parse);
    }
    const latest = {};
    metrics.forEach(m => { if (m.metric) latest[m.metric] = { value: m.value, unit: m.unit || '' }; });

    const rows = Object.entries(latest)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v.value} ${v.unit}</td></tr>`)
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Bot Performance</title>
        <meta http-equiv="refresh" content="30">
        <style>
          body{background:#121212;color:#e0e0e0;font-family:Arial,Helvetica,sans-serif;margin:40px}
          h1{color:#bb86fc}
          table{border-collapse:collapse;min-width:320px}
          th,td{padding:8px 12px;border-bottom:1px solid #333}
          th{text-align:left;color:#83a598}
          a.button{display:inline-block;margin-bottom:15px;padding:8px 14px;background:#bb86fc;color:#121212;border-radius:4px;text-decoration:none;font-weight:bold}
        </style>
      </head>
      <body>
        <h1>Live Bot Performance</h1>
        <a class="button" href="/logs">📄 View Raw Logs</a>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          ${rows}
        </table>
        <p style="margin-top:40px">
          Last updated: ${new Date().toLocaleTimeString()} (auto-refresh 30 s)
        </p>
      </body>
      </html>`;
    res.send(html);
  });

  /* ---------- 2. RAW LOG VIEWER ( /logs ) ---------- */
  app.get('/logs', (req, res) => {
    fs.readFile(humanLog, 'utf8', (err, data) => {
      if (err) {
        log.error('Could not read log file for web view.', err);
        return res.status(500).send('Error reading log file.');
      }
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <title>Trading Bot Logs</title>
          <meta http-equiv="refresh" content="30">
          <style>
            body{background:#121212;color:#e0e0e0;font-family:Courier,monospace;font-size:14px;margin:0;padding:20px}
            h1{color:#bb86fc}
            pre{white-space:pre-wrap;background:#1e1e1e;padding:15px;border-radius:5px;border:1px solid #333}
            a.button{display:inline-block;margin-bottom:15px;padding:8px 14px;background:#bb86fc;color:#121212;border-radius:4px;text-decoration:none;font-weight:bold}
          </style>
        </head>
        <body>
          <h1>Trading Bot Live Log</h1>
          <a class="button" href="/">📊 Back to Performance</a>
          <p>Last updated: ${new Date().toLocaleTimeString()}. Auto-refresh every 30 seconds.</p>
          <pre>${data.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
        </body>
        </html>`;
      res.send(html);
    });
  });

  app.listen(PORT, () => {
    log.info(`Dashboard: http://localhost:${PORT}/`);
    log.info(`Raw logs:  http://localhost:${PORT}/logs`);
  });
}
