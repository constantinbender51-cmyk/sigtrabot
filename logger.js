import fs from 'fs';
import path from 'path';
import { format } from 'date-fns';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

// Human file + machine file
const humanLog = path.join(logDir, 'trading-bot.log');
const jsonLog  = path.join(logDir, 'metrics.ndjson');   // ND-JSON = 1 JSON per line

class Logger {
  _write(kind, msg, extra = {}) {
    const ts = new Date().toISOString();
    const humanLine = `[${ts}] [${kind.padEnd(5)}] ${msg}`;
    console.log(humanLine);
    fs.appendFileSync(humanLog, humanLine + '\n');

    if (Object.keys(extra).length) {
      fs.appendFileSync(
        jsonLog,
        JSON.stringify({ ts, level: kind, msg, ...extra }) + '\n'
      );
    }
  }

  info(msg, extra)  { this._write('INFO',  msg, extra); }
  warn(msg, extra)  { this._write('WARN',  msg, extra); }
  error(msg, err)   {
    const extra = err ? { error: err.message, stack: err.stack } : {};
    this._write('ERROR', msg, extra);
  }

  /* -------- NEW: numeric metrics -------- */
  metric(name, value, unit = '', tags = {}) {
    this._write('METRIC', `${name} = ${value} ${unit}`, { metric: name, value, unit, ...tags });
  }
}

export const log = new Logger();
