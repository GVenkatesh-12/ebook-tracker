import http from 'node:http';
import { appendFileSync } from 'node:fs';
const PORT = Number(process.argv[2]);
let failRemaining = Number(process.argv[3] || 0);
const EVENT_DELAY_MS = Number(process.argv[4] || 0);
let requestCount = 0;
const log = (line) => appendFileSync('/tmp/ercheck-mock.log', line + '\n');
const pcm = new Int16Array(2400);
for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 20) * 3000);
const pcmBase64 = Buffer.from(pcm.buffer).toString('base64');
http.createServer((req, res) => {
  requestCount++;
  log('#' + requestCount + ' ' + req.method + ' ' + req.url);
  if (req.method !== 'POST' || !req.url.startsWith('/v1beta/interactions')) { res.writeHead(404).end('nf'); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    log('key=' + req.headers['x-goog-api-key']);
    log('body=' + body.slice(0, 300));
    if (failRemaining > 0) {
      failRemaining--;
      log('-> 500 INTERNAL, remaining=' + failRemaining);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 500, message: 'INTERNAL: simulated' } }));
      return;
    }
    const events = [
      { event_type: 'interaction.created', interaction: { id: 'v1_t', status: 'in_progress' } },
      { event_type: 'step.start', index: 0, step: { type: 'model_output' } },
      ...Array.from({ length: 3 }, () => ({ event_type: 'step.delta', index: 0, delta: { type: 'audio', data: pcmBase64, mime_type: 'audio/l16', sample_rate: 24000, channels: 1 } })),
      { event_type: 'step.stop', index: 0 },
      { event_type: 'interaction.completed', interaction: { id: 'v1_t', status: 'completed' } },
    ];
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    (async () => {
      for (const ev of events) {
        res.write('data: ' + JSON.stringify(ev) + '\n\n');
        await new Promise((r) => setTimeout(r, EVENT_DELAY_MS));
        if (req.destroyed) return;
      }
      res.write('data: [DONE]\n\n');
      res.end();
    })();
  });
}).listen(PORT, '127.0.0.1', () => log('listening on ' + PORT));
