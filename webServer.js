import express from 'express';
import fs from 'fs';
import path from 'path';
import { log } from './logger.js';

const PORT = process.env.PORT || 3000; // Railway provides the PORT env var
const logFilePath = path.join(process.cwd(), 'logs', 'trading-bot.log');

/**
 * Starts a web server to display the bot's log file.
 */
export function startWebServer() {
    const app = express();

    // Main endpoint to view the logs
    app.get('/', (req, res) => {
        fs.readFile(logFilePath, 'utf8', (err, data) => {
            if (err) {
                log.error('Could not read log file for web view.', err);
                return res.status(500).send('Error reading log file.');
            }

            // Simple HTML wrapper for better presentation
            const html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Trading Bot Logs</title>
                    <meta http-equiv="refresh" content="30"> <!-- Auto-refresh every 30 seconds -->
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
                    </style>
                </head>
                <body>
                    <h1>Trading Bot Live Log</h1>
                    <p>Last updated: ${new Date().toLocaleTimeString()}. Page auto-refreshes every 30 seconds.</p>
                    <pre>${data.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
                </body>
                </html>
            `;
            res.send(html);
        });
    });

    app.listen(PORT, () => {
        log.info(`Web server started. Log viewer is available at http://localhost:${PORT}`);
    });
}
