import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';

/**
 * Server-side variables the AI handlers read. Copied into `process.env` for the
 * dev server only.
 *
 * None of these may ever be given a `VITE_` prefix or passed to `define`: Vite
 * inlines those into the browser bundle, which would ship the key to every
 * visitor (Constitution III).
 */
const AI_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL_FAST',
  'GEMINI_MODEL_VISION',
  'GEMINI_MODEL_CHEAP',
  'AI_DAILY_CALL_BUDGET',
  'AI_RATE_LIMIT_PER_MIN',
] as const;

/** Route names are file names — keep anything path-like out of the lookup. */
const ROUTE_NAME = /^[a-z0-9-]+$/;

/**
 * Serves `/api/ai/*` from the same handler modules Vercel will run, so
 * `npm run dev` stays the single command and the Vercel CLI is not a dependency.
 *
 * Registered directly inside `configureServer` (not via a returned post-hook) so
 * it is installed *ahead* of Vite's proxy middleware: `/api/ai/*` is handled
 * here, while `/api/projects*` still proxies to Express on :3001.
 */
function aiDevServer(): Plugin {
  const routesDir = path.resolve(__dirname, '../api/ai');

  return {
    name: 'tileflow-ai-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '';
        if (!rawUrl.startsWith('/api/ai/')) return next();

        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };

        try {
          const { pathname } = new URL(rawUrl, 'http://localhost');
          const name = pathname.slice('/api/ai/'.length);
          if (!ROUTE_NAME.test(name)) return send(404, { error: 'Not found' });

          const file = path.join(routesDir, `${name}.ts`);
          // Belt and braces: the regex already excludes separators and dots.
          if (!file.startsWith(routesDir + path.sep) || !fs.existsSync(file)) {
            return send(404, { error: 'Not found' });
          }

          // ssrLoadModule re-evaluates on change, so editing a handler is
          // reflected on the next request with no restart.
          const mod = await server.ssrLoadModule(file);
          const method = (req.method ?? 'GET').toUpperCase();
          const handler = mod[method];

          if (typeof handler !== 'function') {
            const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
              (m) => typeof mod[m] === 'function'
            );
            res.setHeader('Allow', allowed.join(', '));
            return send(405, { error: `Method ${method} not allowed.`, code: 'bad_request' });
          }

          const response: Response = await handler(toWebRequest(req, rawUrl));

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));

          if (!response.body) return res.end();
          // Piped, never buffered — 004 streams its brief through here.
          Readable.fromWeb(response.body as never).pipe(res);
        } catch (err) {
          server.config.logger.error(`[ai-dev] ${String(err)}`);
          send(500, { error: 'Internal server error', code: 'internal' });
        }
      });
    },
  };
}

/** Connect `IncomingMessage` → Web `Request`, the shape the handlers take. */
function toWebRequest(req: IncomingMessage, rawUrl: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value != null) headers.set(key, value);
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const url = `http://${req.headers.host ?? 'localhost:5173'}${rawUrl}`;

  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    // Required by undici whenever the body is a stream.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '..');

  // Vite reads env files from its own root (client/) into `import.meta.env`, and
  // never into `process.env`. The handlers read `process.env`, and the key lives
  // at the repo root — so without this the routes report "unconfigured" no
  // matter what `.env.local` contains. '' as the prefix loads every variable,
  // not just VITE_ ones; only the allow-list above is copied across.
  const env = loadEnv(mode, repoRoot, '');
  for (const key of AI_ENV_KEYS) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), aiDevServer()],
    resolve: {
      alias: {
        '@tileflow/geometry': path.resolve(__dirname, '../packages/geometry/src/index.ts'),
      },
    },
    worker: {
      format: 'es',
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
