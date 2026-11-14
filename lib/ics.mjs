// 生成日历订阅文件（.ics），不依赖第三方库
function pad(n) { return String(n).padStart(2, '0'); }

export function toUtcStamp(date, time) {
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = String(time || '09:00').split(':').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) + 'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + pad(dt.getUTCSeconds()) + 'Z';
}

export function todayStamp() {
  const d = new Date();
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

function fold(line) {
  const s = String(line).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const out = [];
  for (let i = 0; i < s.length; i += 70) out.push((i ? ' ' : '') + s.slice(i, i + 70));
  return out.join('\r\n');
}

export function eventToIcs({ uid, title, date, time, durationMin = 60, description = '', location = '', url = '' }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
  const start = toUtcStamp(date, time || '09:00');
  const [hh, mm] = String(time || '09:00').split(':').map(Number);
  const endMin = (hh || 0) * 60 + (mm || 0) + durationMin;
  const endH = String(Math.floor(endMin / 60) % 24).padStart(2, '0');
  const endM = String(endMin % 60).padStart(2, '0');
  const end = toUtcStamp(date, endH + ':' + endM);
  return [
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + todayStamp(),
    'DTSTART:' + start,
    'DTEND:' + end,
    fold('SUMMARY:' + title),
    description ? fold('DESCRIPTION:' + description) : '',
    location ? fold('LOCATION:' + location) : '',
    url ? fold('URL:' + url) : '',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

export function buildCalendar(events, calName = '简历投递日程') {
  const body = events.map(eventToIcs).filter(Boolean).join('\r\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Resume Agent//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:' + calName),
    body,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function eventsFromApps(items, { appId, eventId } = {}) {
  const list = [];
  for (const a of items) {
    if (appId && a.id !== appId) continue;
    if (!eventId || eventId === 'apply') {
      if (a.appliedAt) list.push({ uid: a.id + '-apply@resume-agent', title: '投递 ' + a.company + (a.role ? ' · ' + a.role : ''), date: a.appliedAt, time: '10:00', durationMin: 30, description: '渠道：' + (a.channel || '未填'), location: a.location || '', url: a.link || '' });
    }
    if (!eventId || eventId === 'deadline') {
      if (a.deadline) list.push({ uid: a.id + '-deadline@resume-agent', title: '截止日期 · ' + a.company, date: a.deadline, time: '18:00', durationMin: 30, description: a.role || '' });
    }
    for (const e of a.events || []) {
      const eid = e.id || (a.id + '-' + (e.date || '') + '-' + (e.type || ''));
      if (eventId && eventId !== 'apply' && eventId !== 'deadline' && eid !== eventId) continue;
      if (eventId === 'apply' || eventId === 'deadline') continue;
      const dur = /笔试|测评/.test(e.type) ? 120 : /面/.test(e.type) ? 60 : 30;
      list.push({ uid: eid + '@resume-agent', title: e.type + ' · ' + a.company + (a.role ? ' · ' + a.role : ''), date: e.date, time: e.time || '14:00', durationMin: dur, description: [e.note, a.contact].filter(Boolean).join('\n'), location: a.location || '', url: a.link || '' });
    }
  }
  return list;
}
