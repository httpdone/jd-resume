// 往正在运行的工作台里写入 1 条演示用的投递记录，并附 3 条示例日程（笔试 / 一面 / 二面）。
// 已有「字节跳动 · 大模型应用开发实习」时不会重复添加，也不会删掉你自己建的其他投递。
// 若该示例已在、但还没有日程，只会补上这 3 条（已有日程则不动）。
// 用法：先 npm start（或 node tests/demo-server.mjs），再另开一个终端：node tests/seed-demo.mjs [端口，默认 4321]
// 示例简历「张明-…」需先在 设置 → 导入示例数据 导入。
const port = process.argv[2] || 4321;
const B = 'http://127.0.0.1:' + port;
const DEMO_EVENTS = [
  { id: 'ev-demo-exam', type: '笔试', date: '2026-11-18', time: '14:00', note: '在线笔试' },
  { id: 'ev-demo-iv1', type: '一面', date: '2026-11-25', time: '14:00' },
  { id: 'ev-demo-iv2', type: '二面', date: '2026-12-02', time: '14:00' },
];
const demo = {
  company: '字节跳动',
  role: '大模型应用开发实习',
  status: '待投递',
  channel: '官网',
  link: 'https://jobs.bytedance.com',
  resumeSlug: '张明-字节跳动-大模型应用开发实习',
  notes: '示例投递：日历上有笔试（11/18）、一面（11/25）、二面（12/02），可改状态或再加日程。',
  events: DEMO_EVENTS,
};
const list = await fetch(B + '/api/apps').then((r) => r.json());
const item = (list.items || []).find((a) => a.company === demo.company && a.role === demo.role);
if (item) {
  if (!(item.events || []).length) {
    const r = await fetch(B + '/api/apps/' + item.id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: DEMO_EVENTS }),
    });
    const d = await r.json();
    console.log(d.ok ? '✓' : '✗', '已为示例投递补上 3 条日程（笔试 / 一面 / 二面）', d.error || '');
  } else {
    console.log('已有示例投递，未改动你的日程。当前共', (list.items || []).length, '条。');
  }
  process.exit(0);
}
const r = await fetch(B + '/api/apps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(demo) });
const d = await r.json();
console.log(d.ok ? '✓' : '✗', demo.company, '·', demo.role, '（3 条示例日程）', d.error || '');
