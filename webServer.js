import express from 'express';
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

const PORT = process.env.PORT || 3000;
const logFilePath = path.join(process.cwd(), 'logs', 'trading-bot.log');

// --- tiny helper --------------------------------------------------
function parseLogForPerformance() {
  if (!fs.existsSync(logFilePath)) return { cycles: [] };

  const text = fs.readFileSync(logFilePath, 'utf8');
  const lines = text.split('\n');

  const cycles = [];
  let cur = null;

  for (const ln of lines) {
    if (ln.includes('Bot trading cycle starting')) {
      cur = { balance: null, pnl: 0 };
    }
    if (!cur) continue;

    const balMatch = ln.match(/INITIAL_BALANCE[:=]?\s*(\d*\.?\d+)/);
    if (balMatch) cur.balance = parseFloat(balMatch[1]);

    const pnlMatch = ln.match(/Realised PnL[:=]?\s*([+-]?\d*\.?\d+)/);
    if (pnlMatch) cur.pnl += parseFloat(pnlMatch[1]);

    if (ln.includes('Bot trading cycle finished')) {
      cycles.push(cur);
      cur = null;
    }
  }
  return { cycles };
}
// -----------------------------------------------------------------

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
  app.get('/performance', (req, res) => {
    const { cycles } = parseLogForPerformance();

    let totalPnL = 0;
    const balances = [];
    for (const c of cycles) {
      totalPnL += c.pnl;
      if (c.balance !== null) balances.push(c.balance);
    }
    const startBal = balances[0] || 0;
    const endBal = balances[balances.length - 1] || startBal;
    const pctChange = startBal ? ((endBal - startBal) / startBal * 100).toFixed(2) : 0;

    const spark = balances.map((b, i) => `<span title="${b}">${i ? '' : '|'}${b >= (balances[i-1] || b) ? '▲' : '▼'}</span>`).join('');

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
        table{border-collapse:collapse;width:100%;max-width:600px}
        th,td{padding:8px 12px;border-bottom:1px solid #333}
        th{text-align:left;color:#83a598}
        .profit{color:#8ec07c}
        .loss{color:#fb4934}
        .spark{font-family:monospace;letter-spacing:-2px}
      </style>
    </head>
    <body>
      <h1>Performance Overview</h1>
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total Cycles</td><td>${cycles.length}</td></tr>
        <tr><td>Start Balance</td><td>${startBal.toFixed(4)} USD</td></tr>
        <tr><td>Current Balance</td><td>${endBal.toFixed(4)} USD</td></tr>
        <tr><td>Total Realised PnL</td><td class="${totalPnL >= 0 ? 'profit' : 'loss'}">${totalPnL.toFixed(4)} USD</td></tr>
        <tr><td>Return %</td><td class="${pctChange >= 0 ? 'profit' : 'loss'}">${pctChange} %</td></tr>
      </table>

      <h2>Balance History Sparkline</h2>
      <div class="spark">${spark}</div>

      <p style="margin-top:40px">
        <a href="/" style="color:#83a598">⬅ Raw log view</a> | 
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
