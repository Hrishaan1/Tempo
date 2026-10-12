'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calendar = require('../calendar');

/* ---- tiny iCalendar helpers (unfold + split into events) ---- */

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n');
}

function parseEvents(ics) {
  const events = [];
  let current = null;
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') { current = { props: {}, raw: [] }; continue; }
    if (line === 'END:VEVENT') { if (current) events.push(current); current = null; continue; }
    if (!current) continue;
    current.raw.push(line);
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx);
    current.props[name] = line.slice(idx + 1);
  }
  return events;
}

function uids(ics) {
  return parseEvents(ics).map((e) => e.props.UID);
}

function eventByUid(ics, uid) {
  return parseEvents(ics).find((e) => e.props.UID === uid);
}

const BASE = {
  id: 'evt-1',
  title: 'Math homework',
  date: '2026-01-05',
  start: 960,
  end: 1020,
  color: 'peach',
  repeat: 'once',
  excludedDates: [],
  overrides: {},
};

const NOW = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));

/* ---- 1. valid feed generation ---- */

test('builds a valid VCALENDAR wrapper with required metadata', () => {
  const ics = calendar.buildCalendar({ events: [BASE], now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /PRODID:-?\/\/Tempo/);
  assert.match(ics, /END:VCALENDAR$/);
});

test('emits a PUBLISH method and refresh hints', () => {
  const ics = calendar.buildCalendar({ events: [BASE], now: NOW });
  assert.match(ics, /METHOD:PUBLISH/);
  assert.match(ics, /X-PUBLISHED-TTL:PT15M/);
});

/* ---- 2. content type ---- */

test('feed responses use the text/calendar content type', async () => {
  const token = calendar.generateToken();
  const res = await calendar.handleFeedRequest({
    method: 'GET',
    token,
    lookupSubscription: async (hash) => (hash === calendar.hashToken(token) ? { uid: 'u1' } : null),
    getSchedule: async () => ({ events: [BASE] }),
    now: NOW,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/calendar; charset=utf-8');
});

/* ---- 3. UID stability ---- */

test('event UIDs are stable across repeated requests', () => {
  const first = calendar.buildCalendar({ events: [BASE], now: NOW, stamp: NOW });
  const second = calendar.buildCalendar({ events: [BASE], now: NOW, stamp: NOW });
  assert.deepEqual(uids(first), uids(second));
  assert.equal(first, second);
});

/* ---- 4. new events appear ---- */

test('a newly added event appears in the feed', () => {
  const before = calendar.buildCalendar({ events: [BASE], now: NOW });
  const extra = { ...BASE, id: 'evt-2', title: 'Study', date: '2026-01-06' };
  const after = calendar.buildCalendar({ events: [BASE, extra], now: NOW });
  assert.equal(uids(before).length, 1);
  assert.equal(uids(after).length, 2);
  assert.ok(uids(after).some((u) => !uids(before).includes(u)));
});

/* ---- 5. edits retain UID ---- */

test('editing an event keeps its UID and updates the summary', () => {
  const edited = { ...BASE, title: 'Math homework (revised)' };
  const before = calendar.buildCalendar({ events: [BASE], now: NOW });
  const after = calendar.buildCalendar({ events: [edited], now: NOW });
  const [uid] = uids(before);
  assert.deepEqual(uids(after), [uid]);
  assert.equal(eventByUid(after, uid).props.SUMMARY, 'Math homework (revised)');
});

/* ---- 6. rescheduling updates times under the same UID ---- */

test('rescheduling keeps the UID and changes DTSTART/DTEND', () => {
  const moved = { ...BASE, start: 1110, end: 1170 };
  const before = calendar.buildCalendar({ events: [BASE], now: NOW });
  const after = calendar.buildCalendar({ events: [moved], now: NOW });
  const [uid] = uids(before);
  assert.deepEqual(uids(after), [uid]);
  assert.equal(eventByUid(after, uid).props.DTSTART, '20260105T183000');
  assert.equal(eventByUid(after, uid).props.DTEND, '20260105T193000');
});

/* ---- 7. deletion removes the event ---- */

test('a deleted event no longer appears in the feed', () => {
  const before = calendar.buildCalendar({ events: [BASE], now: NOW });
  const [uid] = uids(before);
  const after = calendar.buildCalendar({ events: [], now: NOW });
  assert.ok(!uids(after).includes(uid));
  assert.equal(uids(after).length, 0);
});

/* ---- 8. all-day serialization ---- */

test('all-day notes serialize as VALUE=DATE spanning the day', () => {
  const ics = calendar.buildCalendar({
    events: [],
    allDay: [{ id: 'ad-1', title: 'No school', date: '2026-01-05', repeat: 'once', excludedDates: [] }],
    now: NOW,
  });
  const [ev] = parseEvents(ics);
  assert.equal(ev.props['DTSTART;VALUE=DATE'], '20260105');
  assert.equal(ev.props['DTEND;VALUE=DATE'], '20260106');
});

/* ---- 9. recurring behavior ---- */

test('weekly recurrence expands to matching weekdays only', () => {
  const weekly = { ...BASE, id: 'weekly-1', repeat: 'weekly', date: '2026-01-05' }; // Monday
  const ics = calendar.buildCalendar({ events: [weekly], now: NOW });
  const keys = uids(ics).map((u) => u.match(/^tempo-(\d{4}-\d{2}-\d{2})-/)[1]);
  assert.ok(keys.length >= 5);
  for (const k of keys) {
    assert.equal(new Date(k + 'T00:00:00Z').getUTCDay(), 1, `${k} should be a Monday`);
  }
});

test('weekday recurrence skips Saturdays and Sundays', () => {
  const weekdays = { ...BASE, id: 'wd-1', repeat: 'weekdays', date: '2026-01-05' };
  const ics = calendar.buildCalendar({ events: [weekdays], now: NOW });
  const keys = uids(ics).map((u) => u.match(/^tempo-(\d{4}-\d{2}-\d{2})-/)[1]);
  assert.ok(keys.length > 5);
  for (const k of keys) {
    const dow = new Date(k + 'T00:00:00Z').getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, `${k} should be a weekday`);
  }
});

test('recurring exclusions drop exactly that occurrence', () => {
  const daily = { ...BASE, id: 'daily-1', repeat: 'daily', date: '2026-01-05', excludedDates: ['2026-01-07'] };
  const ics = calendar.buildCalendar({ events: [daily], now: NOW });
  assert.ok(!uids(ics).some((u) => u.startsWith('tempo-2026-01-07-')));
  assert.ok(uids(ics).some((u) => u.startsWith('tempo-2026-01-06-')));
});

test('a single-occurrence override keeps the UID and changes the time', () => {
  const daily = {
    ...BASE,
    id: 'daily-2',
    repeat: 'daily',
    date: '2026-01-05',
    overrides: { '2026-01-08': { title: 'Moved', start: 1080, end: 1140 } },
  };
  const ics = calendar.buildCalendar({ events: [daily], now: NOW });
  const uid = uids(ics).find((u) => u.startsWith('tempo-2026-01-08-'));
  const ev = eventByUid(ics, uid);
  assert.equal(ev.props.SUMMARY, 'Moved');
  assert.equal(ev.props.DTSTART, '20260108T180000');
});

/* ---- 10. time zone / DST behavior ---- */

test('floating times have no UTC suffix and preserve wall-clock time', () => {
  const ics = calendar.buildCalendar({ events: [BASE], now: NOW });
  const [ev] = parseEvents(ics);
  assert.equal(ev.props.DTSTART, '20260105T160000');
  assert.ok(!/Z$/.test(ev.props.DTSTART));
  assert.ok(!/TZID/.test(ev.raw.find((l) => l.startsWith('DTSTART'))));
});

test('time is preserved across a US daylight-saving boundary', () => {
  const dst = { ...BASE, id: 'dst-1', date: '2026-03-08', start: 960, end: 1020 };
  const ics = calendar.buildCalendar({ events: [dst], now: new Date(Date.UTC(2026, 2, 1)) });
  const [ev] = parseEvents(ics);
  assert.equal(ev.props.DTSTART, '20260308T160000'); // still 4:00 PM local
});

/* ---- 11. escaping / unicode / folding ---- */

test('escapes commas, semicolons, backslashes, newlines and passes Unicode', () => {
  const tricky = {
    ...BASE,
    id: 'tricky-1',
    title: 'Café ☕ résumé, part; two\\three\nnext line — 日本語',
  };
  const ics = calendar.buildCalendar({ events: [tricky], now: NOW });
  const [ev] = parseEvents(ics);
  assert.equal(ev.props.SUMMARY, 'Café ☕ résumé\\, part\\; two\\\\three\\nnext line — 日本語');
});

test('folds long lines at 75 octets', () => {
  const long = { ...BASE, id: 'long-1', title: 'x'.repeat(400) };
  const ics = calendar.buildCalendar({ events: [long], now: NOW });
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
  }
});

/* ---- 12. invalid / revoked tokens ---- */

test('rejects a malformed token with a generic 404', async () => {
  const res = await calendar.handleFeedRequest({
    method: 'GET',
    token: 'not a token!',
    lookupSubscription: async () => ({ uid: 'u1' }),
    getSchedule: async () => ({ events: [BASE] }),
  });
  assert.equal(res.status, 404);
  assert.equal(res.body, 'Not found');
});

test('rejects a revoked/unknown token with a generic 404', async () => {
  const res = await calendar.handleFeedRequest({
    method: 'GET',
    token: calendar.generateToken(),
    lookupSubscription: async () => null,
    getSchedule: async () => ({ events: [BASE] }),
  });
  assert.equal(res.status, 404);
});

test('rejects non-GET methods', async () => {
  const res = await calendar.handleFeedRequest({ method: 'POST', token: calendar.generateToken() });
  assert.equal(res.status, 405);
});

test('returns 304 when the client supplies a matching ETag', async () => {
  const token = calendar.generateToken();
  const args = {
    method: 'GET',
    token,
    lookupSubscription: async () => ({ uid: 'u1' }),
    getSchedule: async () => ({ events: [BASE], updatedAt: NOW.toISOString() }),
    now: NOW,
  };
  const first = await calendar.handleFeedRequest(args);
  const second = await calendar.handleFeedRequest({ ...args, ifNoneMatch: first.headers.ETag });
  assert.equal(second.status, 304);
  assert.equal(second.body, '');
});

/* ---- 13. cross-user isolation ---- */

test("one user's token can never resolve another user's schedule", async () => {
  const tokenA = calendar.generateToken();
  const tokenB = calendar.generateToken();
  const schedules = { uA: { events: [BASE] } };
  const lookupSubscription = async (hash) => {
    if (hash === calendar.hashToken(tokenA)) return { uid: 'uA' };
    return null; // tokenB was never issued
  };
  const getSchedule = async (uid) => schedules[uid] || null;

  const a = await calendar.handleFeedRequest({ method: 'GET', token: tokenA, lookupSubscription, getSchedule, now: NOW });
  assert.equal(a.status, 200);

  const b = await calendar.handleFeedRequest({ method: 'GET', token: tokenB, lookupSubscription, getSchedule, now: NOW });
  assert.equal(b.status, 404);
  assert.ok(!b.body.includes('Math homework'));
});

/* ---- 14. malformed data ---- */

test('skips malformed events without failing the whole feed', () => {
  const ics = calendar.buildCalendar({
    events: [
      BASE,
      null,
      { id: 'broken', title: 'No date' },
      { id: 'broken2', title: 'Bad span', date: '2026-01-05', start: 600, end: 500 },
      { id: 'broken3', title: 'Bad date', date: 'soon', start: 600, end: 700 },
    ],
    allDay: [{ id: 'ad', title: 42, date: '2026-01-05' }],
    now: NOW,
  });
  assert.equal(uids(ics).length, 1);
  assert.match(ics, /Math homework/);
});

test('an empty schedule still yields a valid calendar', () => {
  const ics = calendar.buildCalendar({ events: undefined, allDay: undefined, now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /END:VCALENDAR/);
  assert.equal(parseEvents(ics).length, 0);
});

/* ---- 15. token primitives ---- */

test('tokens are high entropy and only their hash is derivable', () => {
  const a = calendar.generateToken();
  const b = calendar.generateToken();
  assert.equal(a.length, 43);
  assert.notEqual(a, b);
  assert.equal(calendar.hashToken(a), calendar.hashToken(a));
  assert.equal(calendar.hashToken(a).length, 64);
  assert.notEqual(calendar.hashToken(a), a);
  assert.ok(calendar.looksLikeToken(a));
});

test('recurrence semantics match the client occurs() rules', () => {
  const weekly = { ...BASE, repeat: 'weekly', date: '2026-01-05' };
  assert.ok(calendar.occursOn(weekly, '2026-01-05'));
  assert.ok(calendar.occursOn(weekly, '2026-01-12'));
  assert.ok(!calendar.occursOn(weekly, '2026-01-13'));
  const once = { ...BASE, repeat: 'once' };
  assert.ok(calendar.occursOn(once, '2026-01-05'));
  assert.ok(!calendar.occursOn(once, '2026-01-06'));
});
