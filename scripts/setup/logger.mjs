import { mkdir, appendFile } from 'node:fs/promises';

import { sanitizeLogValue } from './core.mjs';

export class SetupLogger {
  constructor(logUrl) {
    this.logUrl = logUrl;
  }

  async write(level, message) {
    await mkdir(new URL('.', this.logUrl), { recursive: true });
    const clean = sanitizeLogValue(message).replace(/[\r\n]+/g, ' ');
    await appendFile(
      this.logUrl,
      `${new Date().toISOString()} ${level.toUpperCase()} ${clean}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  info(message) {
    return this.write('info', message);
  }

  error(message) {
    return this.write('error', message);
  }
}

