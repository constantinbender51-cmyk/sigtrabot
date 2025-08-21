// webServer.js  (white & sleek)
import express from 'express';
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

const PORT = process.env.PORT || 3000;
const metricsFile = path.join(process.cwd(), 'logs', 'metrics.ndjson');
const humanLog    = path.join(process.cwd(), 'logs', 'trading-bot.log');

const css = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#212529;background:#ffffff;line-height:1.6;padding:2rem}
  h1{margin-bottom:1.2rem;font-weight:600;color:#0f62fe}
  a.btn{display:inline-block;margin-bottom:1.5rem;padding:.6rem 1.2rem;border-radius:6px;background:#0f62fe;color:#fff;text-decoration:none;font-size:.9rem;transition:background .2s}
  a.btn:hover{background:#0043ce}
  table{width:100%;max-width:600px;border-collapse:collapse;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  th,td{padding:.75rem 1rem;text-align:left;border-bottom:1px solid #e5e5e5}
  th{font-weight:600;color:#495057;background:#f8f9fa}
  tr:last-child td{border-bottom:none}
  pre{background:#f8f9fa;border:1px solid #e5e5e5;border-radius:4px;padding:1rem;font-size:.85rem;white-space:pre-wrap;word-break:break-all;color:#212529}
  .subtitle{font-size:.9rem;color:#6c757d;margin-bottom:1.5rem}
`;

export function startWebServer() {
  const app = express();

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
        <style>${css}</style>
      </head>
      <body>
        <h1>Live Bot Performance</h1>
        <a class="btn" href="/logs">📄 Raw Logs</a>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          ${rows}
        </table>
        <p class="subtitle">Last updated: ${new Date().toLocaleTimeString()}</p>
      </body>
      </html>`;
    res.send(html);
  });

  app.get('/logs', (req, res) => {
    fs.readFile(humanLog, 'utf8', (err, data) => {
      if (err) return res.status(500).send('Cannot read log file.');
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <title>Trading Bot Logs</title>
          <meta http-equiv="refresh" content="30">
          <style>${css}</style>
        </head>
        <body>
          <h1>Trading Bot Logs</h1>
          <a class="btn" href="/">📊 Performance</a>
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
