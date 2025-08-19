import fs from 'fs';
import path from 'path';

// Define the path for the log file in the project's root directory
const logDirectory = path.join(process.cwd(), 'logs');
const logFilePath = path.join(logDirectory, 'trading-bot.log');

// Ensure the 'logs' directory exists
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

/**
 * @class Logger
 * @description A simple logger that writes to both the console and a file.
 */
class Logger {
    /**
     * Appends a formatted message to the log file.
     * @private
     * @param {string} message - The message to write.
     */
    _writeToFile(message) {
        // 'a' flag is for appending, which is what we want for a log file.
        fs.appendFile(logFilePath, message + '\n', (err) => {
            if (err) {
                // If logging to file fails, log the error to the console.
                console.error('FATAL: Could not write to log file.', err);
            }
        });
    }

    /**
     * Formats a message with a timestamp and log level.
     * @private
     * @param {'INFO' | 'WARN' | 'ERROR' | 'DEBUG'} level - The log level.
     * @param {string} message - The log message.
     * @returns {string} The formatted message.
     */
    _formatMessage(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }

    /**
     * Logs an informational message.
     * @param {string} message - The message to log.
     */
    info(message) {
        const formatted = this._formatMessage('INFO', message);
        console.log(formatted);
        this._writeToFile(formatted);
    }

    /**
     * Logs a warning message.
     * @param {string} message - The message to log.
     */
    warn(message) {
        const formatted = this._formatMessage('WARN', message);
        console.warn(formatted); // Use console.warn for yellow text in many terminals
        this._writeToFile(formatted);
    }

    /**
     * Logs an error message.
     * @param {string} message - The message to log.
     * @param {Error} [error] - An optional error object to include.
     */
    error(message, error) {
        let fullMessage = message;
        if (error) {
            // Include the error's message and stack trace for better debugging
            fullMessage += ` | Error: ${error.message || 'Unknown Error'}`;
            if (error.stack) {
                fullMessage += `\nStack Trace: ${error.stack}`;
            }
        }
        const formatted = this._formatMessage('ERROR', fullMessage);
        console.error(formatted); // Use console.error for red text
        this._writeToFile(formatted);
    }
}

// Export a single, shared instance of the logger
export const log = new Logger();
