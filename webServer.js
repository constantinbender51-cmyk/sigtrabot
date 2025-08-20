import express from 'express';
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

const PORT = process.env.PORT || 3000;
const logFilePath = path.join(process.cwd(), 'logs', 'trading-bot.log');
const statsFile   = path.join(process.cwd(), 'logs', 'stats.json');

export function startWebServer() {
  const app = express();

  app.get('/', (_req, res) => {
    fs.readFile(logFilePath, 'utf8', (err, logData) => {
      if (err) {
        log.error('Could not read log file for web view.', err);
        return res.status(500).send('Error reading log file.');
      }

      let stats = null;
      try {
        stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
      } catch { /* file might not exist yet */ }

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Trading Bot Logs</title>
  <meta http-equiv="refresh" content="30">
  <style>
    body { background:#121212;color:#e0e0e0;font-family:'Courier New',monospace;padding:20px;margin:0; }
    h1   { color:#bb86fc; }
    h2   { color:#fabd2f;margin-top:30px; }
    pre  { white-space:pre-wrap;word-wrap:break-word;background:#1e1e1e;padding:15px;border-radius:5px;border:1px solid #333; }
    table { border-collapse:collapse;margin-bottom:20px; }
    th,td { padding:6px 12px;border:1px solid #333; }
    th { background:#1e1e1e; }
  </style>
</head>
<body>
  <h1>Trading Bot Live Log</h1>
  <p>Last updated: ${new Date().toLocaleTimeString()}. Auto-refresh every 30 s.</p>

  ${stats ? `
  <h2>Latest Performance</h2>
  <table>
    <tr><th>Initial Balance</th><td>$${stats.initialBalance.toFixed(2)}</td></tr>
    <tr><th>Final Balance</th><td>$${stats.finalBalance.toFixed(2)}</td></tr>
    <tr><th>Total P&L</th><td>$${stats.totalPnl.toFixed(2)}</td></tr>
    <tr><th>Total Trades</th><td>${stats.totalTrades}</td></tr>
    <tr><th>Winning Trades</th><td>${stats.winningTrades}</td></tr>
    <tr><th>Losing Trades</th><td>${stats.losingTrades}</td></tr>
    <tr><th>Win Rate</th><td>${stats.winRate.toFixed(2)}%</td></tr>
  </table>

  <h2>Trade Log</h2>
  <pre>${stats.trades
    .map((t, i) => `#${i + 1}: ${t.signal} | P&L: $${t.pnl.toFixed(2)} | Reason: ${t.reason}`)
    .join('\n')}</pre>` : '<p>No performance stats yet.</p>'}

  <h2>Raw Log</h2>
  <pre>${logData.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
</body>
</html>`;
      res.send(html);
    });
  });

  app.listen(PORT, () => {
    log.info(`Web server started. Log viewer is available at http://localhost:${PORT}`);
  });
}
