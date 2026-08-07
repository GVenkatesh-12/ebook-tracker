import mongoose from 'mongoose';
import { appendFileSync } from 'node:fs';
mongoose.connect = async () => ({});
const realFetch = globalThis.fetch;
const MOCK_BASE = process.env.MOCK_GEMINI_URL;
if (MOCK_BASE) {
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? String(input) : input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    appendFileSync('/tmp/ercheck-hook.log', method + ' ' + String(href) + '\n');
    if (String(href).startsWith('https://generativelanguage.googleapis.com')) {
      const rewritten = new URL(href);
      rewritten.protocol = 'http:';
      rewritten.host = new URL(MOCK_BASE).host;
      // The SDK passes a Request object; rebuild it against the mock URL so
      // method, headers, body and signal are preserved.
      if (input && typeof input === 'object' && typeof input.method === 'string') {
        input = new Request(rewritten, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: input.signal,
          redirect: input.redirect,
          duplex: input.duplex || 'half',
        });
      } else {
        input = rewritten;
      }
      appendFileSync('/tmp/ercheck-hook.log', 'REWRITE -> ' + input.method + ' ' + String(input.url) + '\n');
      const res = await realFetch(input, init);
      appendFileSync('/tmp/ercheck-hook.log', 'STATUS ' + res.status + '\n');
      return res;
    }
    return realFetch(input, init);
  };
}
