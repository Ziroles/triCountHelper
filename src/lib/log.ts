/**
 * Application logging, written **to the server terminal**.
 *
 * In development, every line goes out over the HMR channel and shows up in the
 * console running `npm run dev` (see `tools/vite-plugin-dev-log.ts`). The
 * browser console stays deliberately quiet: on a phone it is unreadable anyway,
 * and two logs to compare are worth less than one complete one. `VITE_LOG_ECHO=1`
 * turns it back on when you want it in front of you in the tab.
 *
 * In production there is no server to talk to: only warnings and errors go to
 * the browser console, and the rest disappears — `import.meta.env.DEV` is a
 * build-time constant, so `debug`-level calls are stripped from the shipped
 * bundle.
 *
 * Three rules guided what gets instrumented:
 *
 * **One line per boundary.** Network, local database, service worker: anything
 * crossing an edge is visible. Pure computation is not — it has tests.
 *
 * **A duration whenever we wait.** A request without its timing does not say
 * whether the problem is the server or the network.
 *
 * **Never a secret.** Tokens, keys and passwords are masked before being sent:
 * the terminal gets read by several people, and pasted into reports.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

function configuredLevel(): number {
  const raw = (import.meta.env.VITE_LOG_LEVEL as string | undefined)?.trim().toLowerCase();
  if (raw !== undefined && raw in RANK) return RANK[raw as Level | 'silent'];
  return import.meta.env.DEV ? RANK.debug : RANK.warn;
}

const THRESHOLD = configuredLevel();
const ECHO = (import.meta.env.VITE_LOG_ECHO as string | undefined) === '1';
/** Take over the page's `console.*` calls, third-party ones included. */
const CAPTURE_CONSOLE =
  import.meta.env.DEV && (import.meta.env.VITE_LOG_CONSOLE as string | undefined) !== '0';

/** Original console, kept before any takeover: otherwise we call ourselves. */
const native = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  log: console.log.bind(console),
};

/** Tab identifier: two devices on the same server stay distinguishable. */
const SESSION = Math.random().toString(36).slice(2, 6);

const DEV_LOG_EVENT = 'splitticket:log';

// ── Masking ─────────────────────────────────────────────────────────────────

const SECRET_KEY = /token|authorization|password|secret|api_?key|signup/i;
/** A bearer token or a Gemini key spotted inside free-form text. */
const SECRET_TEXT = /\b(Bearer\s+\S+|AIza[0-9A-Za-z_-]{10,})/g;

function mask(value: string): string {
  if (value.length <= 8) return '•••';
  return `${value.slice(0, 3)}…${value.slice(-2)} (${value.length} chars)`;
}

/**
 * Makes a value transmittable: masked, depth-bounded, cycle-free.
 *
 * The channel is JSON. An `Error`, a `Blob` or a DOM node would lose everything
 * that makes them readable — we translate them here rather than letting `{}`
 * land in the terminal.
 */
function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.replace(SECRET_TEXT, (found) => mask(found));
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();

  if (value instanceof Error) {
    const extra = value as Error & { status?: unknown; code?: unknown };
    return {
      error: value.name,
      message: value.message,
      ...(extra.status === undefined ? {} : { status: extra.status }),
      ...(extra.code === undefined ? {} : { code: extra.code }),
    };
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return `[Blob ${value.type || 'unknown'} ${Math.round(value.size / 1024)} KiB]`;
  }
  if (typeof Element !== 'undefined' && value instanceof Element) {
    return `[<${value.tagName.toLowerCase()}>]`;
  }

  if (typeof value !== 'object') return String(value);
  const object = value as object;
  if (seen.has(object)) return '[cycle]';
  if (depth >= 4) return '[…]';
  seen.add(object);

  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((item) => scrub(item, depth + 1, seen));
    return value.length > 20 ? [...head, `… ${value.length - 20} more`] : head;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    out[key] = SECRET_KEY.test(key)
      ? typeof item === 'string'
        ? mask(item)
        : '•••'
      : scrub(item, depth + 1, seen);
  }
  return out;
}

// ── Emission ────────────────────────────────────────────────────────────────

type Source = 'app' | 'console' | 'window';

/**
 * Send to the server, at most until disarmed.
 *
 * The channel may not exist — production bundle, or a run under Vitest where
 * `import.meta.hot` is not a page's. A log must never break what it observes:
 * on the first refusal, we stop trying.
 */
let channel: ((record: unknown) => void) | null =
  import.meta.hot && typeof import.meta.hot.send === 'function'
    ? (record) => import.meta.hot?.send(DEV_LOG_EVENT, record)
    : null;

function toServer(record: unknown): boolean {
  if (!channel) return false;
  try {
    channel(record);
    return true;
  } catch {
    channel = null;
    return false;
  }
}

function emit(level: Level, tag: string, message: string, data?: unknown, source: Source = 'app') {
  if (RANK[level] < THRESHOLD) return;

  const payload = data === undefined ? undefined : scrub(data);
  const stack =
    level === 'error' && data instanceof Error && data.stack
      ? data.stack.split('\n').slice(1, 6).join('\n')
      : undefined;

  const sent = toServer({
    level,
    tag,
    message: message.replace(SECRET_TEXT, (found) => mask(found)),
    at: Date.now(),
    session: SESSION,
    source,
    ...(payload === undefined ? {} : { data: payload }),
    ...(stack === undefined ? {} : { stack }),
  });

  if (sent) {
    // The terminal has the line; the tab only receives it if asked for, and
    // never when it came from the console — it is already there.
    if (!ECHO || source === 'console') return;
  } else if (RANK[level] < RANK.warn) {
    // With no server (production, tests), only warn and error deserve the console.
    return;
  }

  const write = level === 'debug' ? native.debug : native[level];
  if (payload === undefined) write(`[${tag}] ${message}`);
  else write(`[${tag}] ${message}`, payload);
}

export type Logger = {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  /**
   * Times an operation: returns the function that writes the closing line with
   * its duration. Without it you read a start and an end without knowing how
   * much time passed between the two.
   */
  time: (message: string) => (outcome?: string, data?: unknown) => number;
};

/** A module's tagged logger — `logger('api')`, `logger('store')`. */
export function logger(tag: string): Logger {
  return {
    debug: (message, data) => emit('debug', tag, message, data),
    info: (message, data) => emit('info', tag, message, data),
    warn: (message, data) => emit('warn', tag, message, data),
    error: (message, data) => emit('error', tag, message, data),
    time: (message) => {
      const started = performance.now();
      return (outcome, data) => {
        const ms = Math.round(performance.now() - started);
        emit('debug', tag, `${message}${outcome ? ` — ${outcome}` : ''} in ${ms} ms`, data);
        return ms;
      };
    },
  };
}

// ── Console and uncaught-error takeover ─────────────────────────────────────

let installed = false;

/**
 * Redirects `console.*` and uncaught errors to the terminal.
 *
 * This is what makes the difference between "my logs" and "everything the page
 * has to say": React warnings, a promise rejected inside an effect, a render
 * error, now land where we are looking. Call once, at start-up.
 */
export function captureBrowserOutput(): void {
  if (installed || channel === null) return;
  installed = true;

  if (CAPTURE_CONSOLE) {
    // `console.log` has no level of its own: it counts as `debug`.
    const routed: [keyof typeof native, Level][] = [
      ['debug', 'debug'],
      ['log', 'debug'],
      ['info', 'info'],
      ['warn', 'warn'],
      ['error', 'error'],
    ];
    for (const [method, level] of routed) {
      const original = native[method];
      console[method] = (...args: unknown[]) => {
        const [first, ...rest] = args;
        const message = typeof first === 'string' ? first : '';
        // Vite already talks in this terminal: echoing it back would stutter.
        if (!message.startsWith('[vite]')) {
          emit(
            level,
            'console',
            message || '(object)',
            rest.length > 0 ? rest : message === '' ? first : undefined,
            'console',
          );
        }
        original(...args);
      };
    }
  }

  window.addEventListener('error', (event) => {
    emit(
      'error',
      'window',
      `${event.message} (${event.filename}:${event.lineno})`,
      event.error,
      'window',
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    emit('error', 'window', 'unhandled promise rejection', event.reason, 'window');
  });
}
