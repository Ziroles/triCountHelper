/**
 * Forwards the browser's logs to the terminal running `npm run dev`.
 *
 * The channel is the HMR one: `import.meta.hot.send` on the page side,
 * `server.ws.on` here. Nothing new to open, nothing to configure, and the link
 * re-establishes itself after a reload.
 *
 * The point is not to write the same thing twice: it is that a phone lying on
 * the table, where no console can be opened, still leaves its trace where we
 * read it. The plugin only installs in development — in production there is no
 * server to listen.
 */

import { inspect } from 'node:util';
import type { Plugin } from 'vite';

export const DEV_LOG_EVENT = 'splitticket:log';

type Level = 'debug' | 'info' | 'warn' | 'error';

type LogRecord = {
  level: Level;
  tag: string;
  message: string;
  data?: unknown;
  /** Browser timestamp, in milliseconds. */
  at: number;
  /** Emitting tab: tells apart two devices plugged into the same server. */
  session: string;
  /** Origin: explicit call, intercepted console, uncaught error. */
  source?: 'app' | 'console' | 'window';
  stack?: string;
};

const ESC = '\u001b[';
const COLOR = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const paint = (code: string, text: string): string =>
  COLOR ? `${ESC}${code}m${text}${ESC}0m` : text;

const LEVEL_STYLE: Record<Level, { code: string; label: string }> = {
  debug: { code: '2', label: 'debug' },
  info: { code: '36', label: 'info ' },
  warn: { code: '33', label: 'warn ' },
  error: { code: '31', label: 'error' },
};

function isRecord(value: unknown): value is LogRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LogRecord>;
  return (
    typeof candidate.message === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.session === 'string' &&
    candidate.level !== undefined &&
    candidate.level in LEVEL_STYLE
  );
}

function clock(at: number): string {
  const date = Number.isFinite(at) ? new Date(at) : new Date();
  return `${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** Aligns the following lines under the first, so the column holds. */
function indent(text: string, width: number): string {
  return text.split('\n').join(`\n${' '.repeat(width)}`);
}

export function devLogPlugin(): Plugin {
  // A single tab is the common case: we only show the emitter once there is
  // more than one, otherwise the column says nothing.
  const sessions = new Set<string>();

  return {
    name: 'splitticket:dev-log',
    apply: 'serve',
    configureServer(server) {
      server.ws.on(DEV_LOG_EVENT, (payload: unknown) => {
        if (!isRecord(payload)) return;
        sessions.add(payload.session);

        const style = LEVEL_STYLE[payload.level];
        const many = sessions.size > 1;
        const who = many ? `${paint('2', payload.session.padEnd(4))} ` : '';
        const from =
          payload.source === 'console' || payload.source === 'window'
            ? paint('2', `(${payload.source}) `)
            : '';

        // 12 (time) + 1 + 5 (level) + 1 + 12 (tag) + 1, plus the emitter.
        const width = 32 + (many ? 5 : 0);
        const lines = [
          `${paint('2', clock(payload.at))} ${paint(style.code, style.label)} ` +
            `${paint('35', payload.tag.slice(0, 12).padEnd(12))} ` +
            `${who}${from}${indent(payload.message, width)}`,
        ];
        if (payload.data !== undefined) {
          const dump = inspect(payload.data, { depth: 4, colors: COLOR, breakLength: 100 });
          lines.push(indent(dump, width));
        }
        if (payload.stack) lines.push(indent(paint('2', payload.stack), width));

        server.config.logger.info(lines.join(`\n${' '.repeat(width)}`));
      });
    },
  };
}
