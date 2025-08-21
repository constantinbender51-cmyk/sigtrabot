import express from 'express';
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

const PORT = process.env.PORT || 3000;
const logFilePath = path.join(process.cwd(), 'logs', 'trading-bot.log');

export function startWebServer() {
  const app = express();

  // 1. RAW LOG VIEW (unchanged)
  // Main endpoint to view the logs
app.get('/', (req, res) => {
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            log.error('Could not read log file for web view.', err);
            return res.status(500).send('Error reading log file.');
        }

        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Trading Bot Logs</title>
                <meta http-equiv="refresh" content="30">
                <style>
                    body { 
                        background-color: #121212; 
                        color: #e0e0e0; 
                        font-family: 'Courier New', Courier, monospace;
                        font-size: 14px;
                        margin: 0;
                        padding: 20px;
                    }
                    h1 { color: #bb86fc; }
                    pre { 
                        white-space: pre-wrap; 
                        word-wrap: break-word; 
                        background-color: #1e1e1e;
                        padding: 15px;
                        border-radius: 5px;
                        border: 1px solid #333;
                    }
                    .error { color: #cf6679; }
                    .warn { color: #fabd2f; }
                    .info { color: #83a598; }
                    a.button {
                        display: inline-block;
                        margin-bottom: 15px;
                        padding: 8px 14px;
                        background-color: #bb86fc;
                        color: #121212;
                        border-radius: 4px;
                        text-decoration: none;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <h1>Trading Bot Live Log</h1>
                <a class="button" href="/performance">📊 Performance Overview</a>
                <p>Last updated: ${new Date().toLocaleTimeString()}. Page auto-refreshes every 30 seconds.</p>
                <pre>${data.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
            </body>
            </html>
        `;
        res.send(html);
    });
});

  // 2. NEW PERFORMANCE DASHBOARD
  // ----- inside webServer.js -----
app.get('/performance', (req, res) => {
  const jsonLog = path.join(process.cwd(), 'logs', 'metrics.ndjson');
  let metrics = [];
  if (fs.existsSync(jsonLog)) {
    metrics = fs
      .readFileSync(jsonLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  }

  /* ---- build one table row per metric (latest value) ---- */
  const latest = {};
  metrics.forEach(m => {
    if (m.metric) latest[m.metric] = { value: m.value, unit: m.unit || '' };
  });

  const rows = Object.entries(latest)
    .map(([k, v]) => `<tr><td>${k}</td><td>${v.value} ${v.unit}</td></tr>`)
    .join('');

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <title>Bot Metrics</title>
    <meta http-equiv="refresh" content="30">
    <style>
      body{background:#121212;color:#e0e0e0;font-family:Arial,Helvetica,sans-serif;margin:40px}
      h1{color:#bb86fc}
      table{border-collapse:collapse;min-width:320px}
      th,td{padding:8px 12px;border-bottom:1px solid #333}
      th{text-align:left;color:#83a598}
      a{color:#83a598}
    </style>
  </head>
  <body>
    <h1>Live Bot Metrics</h1>
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      ${rows}
    </table>
    <p style="margin-top:40px">
      <a href="/">⬅ Back to raw logs</a> |
      Last updated: ${new Date().toLocaleTimeString()} (auto-refresh 30 s)
    </p>
  </body>
  </html>`;
  res.send(html);
});

  app.listen(PORT, () => {
    log.info(`Web server started. Log viewer: http://localhost:${PORT}`);
    log.info(`Performance dashboard: http://localhost:${PORT}/performance`);
  });
}
