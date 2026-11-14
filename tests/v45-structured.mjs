// v4.5 最小冒烟：JSON Schema 回退链 + 服务能启动。不跑主题扫描或浏览器。
import http from 'node:http';
import { once } from 'node:events';
import { streamChat, resetStructuredOutputCache, isFormatRejection } from '../lib/agent/llm.mjs';
import { SCHEMAS, schemaFor, JSON_TASKS } from '../lib/agent/schemas.mjs';
import { startServer } from '../lib/server.mjs';

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

function sseWrite(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

function startFake(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(JSON.parse(body || '{}'), res, req));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const probeSchema = schemaFor('story_write');
const messages = [{ role: 'user', content: '只输出 JSON：{"html":"<p>ok</p>","reason":"t","todos":[]}' }];

async function chat(port, extra = {}) {
  return streamChat({
    messages,
    json: true,
    schema: probeSchema,
    override: { baseUrl: 'http://127.0.0.1:' + port + '/v1', apiKey: 'test', model: 'fake', structuredOutput: 'auto', temperature: 0, maxTokens: 256, ...extra },
  });
}

function assertStrict(schema, path = 'root') {
  if (!schema || typeof schema !== 'object') throw new Error(path + ': missing');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) throw new Error(path + ': additionalProperties must be false');
    const props = schema.properties || {};
    const req = schema.required || [];
    for (const k of Object.keys(props)) {
      if (!req.includes(k)) throw new Error(path + ': ' + k + ' not required');
      assertStrict(props[k], path + '.' + k);
    }
    if (req.length !== Object.keys(props).length) throw new Error(path + ': required mismatch');
  } else if (schema.type === 'array') {
    assertStrict(schema.items, path + '[]');
  }
}

console.log('schemas');
ok('schemaFor(chat) is null', schemaFor('chat') == null);
ok('schemaFor(diagnose) present', schemaFor('diagnose')?.strict === true && schemaFor('diagnose').name === 'diagnose');
ok('mock_interview review uses review schema', schemaFor('mock_interview', { action: 'review' })?.name === 'mock_interview_review');
ok('mock_interview turn uses turn schema', schemaFor('mock_interview', { action: 'start' })?.name === 'mock_interview');
for (const t of JSON_TASKS) {
  try { assertStrict(SCHEMAS[t]); ok('strict ' + t, true); }
  catch (e) { ok('strict ' + t, false, e.message); }
}

console.log('format rejection detector');
ok('400 json_schema', isFormatRejection(400, 'json_schema is not supported'));
ok('422 response_format', isFormatRejection(422, 'Invalid parameter: response_format'));
ok('400 unavailable now', isFormatRejection(400, 'This response_format type is unavailable now'));
ok('401 not a format error', !isFormatRejection(401, 'json_schema unauthorized'));
ok('400 unrelated', !isFormatRejection(400, 'max_tokens too large'));

console.log('fallback chain');
{
  const { server, port } = await startFake((p, res) => {
    const t = p.response_format?.type;
    if (t !== 'json_schema') { res.writeHead(400); return res.end('{"error":{"message":"expected json_schema"}}'); }
    ok('schema name sent', p.response_format.json_schema?.name === 'story_write');
    ok('schema strict', p.response_format.json_schema?.strict === true);
    sseWrite(res, '{"html":"<p>a</p>","reason":"ok","todos":[]}');
  });
  resetStructuredOutputCache();
  const text = await chat(port);
  ok('(a) json_schema accepted', text.includes('"html"'));
  server.close();
}

{
  const seen = [];
  const { server, port } = await startFake((p, res) => {
    const t = p.response_format?.type || 'off';
    seen.push(t);
    if (t === 'json_schema') { res.writeHead(400); return res.end('{"error":{"message":"json_schema is not supported"}}'); }
    if (t !== 'json_object') { res.writeHead(400); return res.end('{"error":{"message":"unexpected"}}'); }
    sseWrite(res, '{"html":"<p>b</p>","reason":"ok","todos":[]}');
  });
  resetStructuredOutputCache();
  const text = await chat(port, { model: 'fake-b' });
  ok('(b) first call falls back to json_object', text.includes('<p>b</p>') && seen.join(',') === 'json_schema,json_object');
  seen.length = 0;
  const text2 = await chat(port, { model: 'fake-b' });
  ok('(b) cached: later call skips json_schema', text2.includes('<p>b</p>') && seen.join(',') === 'json_object');
  server.close();
}

{
  const seen = [];
  const { server, port } = await startFake((p, res) => {
    const t = p.response_format?.type || 'off';
    seen.push(t);
    if (t === 'json_schema' || t === 'json_object') {
      res.writeHead(422);
      return res.end('{"error":{"message":"response_format is not supported"}}');
    }
    sseWrite(res, '{"html":"<p>c</p>","reason":"ok","todos":[]}');
  });
  resetStructuredOutputCache();
  const text = await chat(port, { model: 'fake-c' });
  ok('(c) both rejected -> plain', text.includes('<p>c</p>') && seen.join(',') === 'json_schema,json_object,off');
  seen.length = 0;
  const text2 = await chat(port, { model: 'fake-c' });
  ok('(c) cached: later call is plain only', text2.includes('<p>c</p>') && seen.join(',') === 'off');
  server.close();
}

console.log('server boot');
{
  const server = startServer({ port: 0, host: '127.0.0.1', open: false });
  await once(server, 'listening');
  const port = server.address().port;
  const res = await fetch('http://127.0.0.1:' + port + '/api/health');
  const body = await res.json().catch(() => ({}));
  ok('GET /api/health HTTP 200', res.status === 200, 'status=' + res.status + ' body=' + JSON.stringify(body).slice(0, 200));
  await new Promise((r) => server.close(r));
}

if (failed) {
  console.error('\n' + failed + ' check(s) failed');
  process.exit(1);
}
console.log('\nall checks passed');
