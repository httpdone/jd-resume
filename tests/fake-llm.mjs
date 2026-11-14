// 测试用：一个假的 OpenAI 兼容服务（流式），用于在没有 Key 时验证真实调用链路
// 用法：node tests/fake-llm.mjs 4999，然后在设置里把 Base URL 填 http://127.0.0.1:4999/v1
import http from 'node:http';

const port = Number(process.argv[2]) || 4999;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake' }, { id: 'fake-pro' }, { id: 'reasoner' }] }));
    }
    if (req.method === 'GET' && url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.1:8b' }] }));
    }
    if (url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{"error":{"message":"not found"}}'); }
    const p = JSON.parse(body || '{}');
    if (p.response_format && process.env.REJECT_JSON_MODE) { res.writeHead(400); return res.end('{"error":{"message":"response_format is not supported"}}'); }
    const sys = p.messages?.[0]?.content || '';
    const user = p.messages?.[p.messages.length - 1]?.content || '';
    let answer;
    if (/改写下面/.test(user)) {
      const ids = [...user.matchAll(/短编号: (\S+)（/g)].map((m) => m[1]);
      answer = '```json\n' + JSON.stringify({ items: ids.map((id) => ({ id, html: '<ul><li><strong>假模型</strong>改写的内容，保留事实【待补充：QPS 数据】</li></ul>', reason: '测试改写', todos: ['QPS 数据'], risk: '' })), summary: '假模型' }) + '\n```';
    } else if (/诊断/.test(user)) {
      const ref = (user.match(/###\s+([A-Z]\d+)/) || [])[1] || 'W1';
      answer = JSON.stringify({ score: 77, level: '良好', verdict: '假模型诊断', tenSecond: '方向清楚', dimensions: [{ name: '结构与 ATS 可读性', score: 80, comment: 'ok' }], highlights: ['a'], issues: [{ level: 'high', itemId: ref, module: '实习经历', problem: '缺少结果，见 ' + ref, suggestion: '补充', evidenceNeeded: '数据' }], riskyClaims: [], questions: ['q1'] });
    } else if (/请只回复两个字/.test(user)) {
      answer = '成功';
    } else {
      answer = '这是**假模型**的回答：\n- 第一点\n- 第二点【待补充：数据】';
    }
    if (/think|reasoner/.test(p.model) || /<think>/.test(user)) {
      answer = '<think>我先分析简历结构……</think>\n```json\n' + (answer.startsWith('```') ? answer.split(/```(?:json)?/)[1] || answer : answer) + '\n```';
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (/reasoner/.test(p.model)) res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '思考…' } }] }) + '\n\n');
    const payloadOf = (text) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
    if (/split-utf8/.test(p.model) || /UTF8SPLIT/.test(user)) {
      // 在多字节汉字中间切开 TCP 包，并让一个 SSE 事件跨两个 write
      const mid = '结构适中，量化程度很好。';
      const body = answer.includes('{') ? answer : mid;
      const bytes = Buffer.from(payloadOf(body), 'utf8');
      const cut = Math.max(1, bytes.indexOf(Buffer.from('中', 'utf8')) + 1); // split inside 中
      res.write(bytes.subarray(0, cut));
      setTimeout(() => {
        res.write(bytes.subarray(cut));
        res.write('data: [DONE]\n\n');
        res.end();
      }, 15);
      return;
    }
    const chunks = answer.match(/[\s\S]{1,17}/g) || [];
    let i = 0;
    const tick = () => {
      if (i >= chunks.length) { res.write('data: [DONE]\n\n'); return res.end(); }
      res.write(payloadOf(chunks[i++]));
      setTimeout(tick, 5);
    };
    tick();
  });
}).listen(port, '127.0.0.1', () => console.log('fake llm on ' + port));
