/*  Exercises the Vercel serverless routes end-to-end with a mocked Firebase
 *  Admin layer, so no credentials or network are needed. Run with: node --test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const calendar = require('../functions/calendar.js');

/* ---- in-memory Firestore stand-in ---- */

function makeDb() {
  const docs = new Map();
  const docRef = (path) => ({
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data) => { docs.set(path, data); },
    delete: async () => { docs.delete(path); },
    collection: (name) => collectionRef(path + '/' + name),
  });
  const collectionRef = (base) => ({ doc: (id) => docRef(base + '/' + id) });
  return {
    docs,
    collection: (name) => collectionRef(name),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(() => ref.set(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
}

const db = makeDb();
const adminPath = require.resolve('../api/_firebaseAdmin.js');
require.cache[adminPath] = {
  id: adminPath,
  filename: adminPath,
  loaded: true,
  exports: {
    getDb: () => db,
    serverTimestamp: () => new Date('2026-01-01T00:00:00Z'),
    verifyBearer: async (req) => {
      const header = String((req.headers && req.headers.authorization) || '');
      if (header === 'Bearer good') return 'user-1';
      const err = new Error('Sign in to use Apple Calendar.');
      err.status = 401;
      throw err;
    },
  },
};

const create = require('../api/createAppleCalendarToken.js');
const revoke = require('../api/revokeAppleCalendarToken.js');
const feed = require('../api/appleCalendarFeed.js');

/* ---- request/response doubles ---- */

function makeReq(opts = {}) {
  return { method: opts.method || 'GET', headers: opts.headers || {}, query: opts.query || {}, socket: {} };
}
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    end(b) { this.body = b === undefined ? '' : String(b); },
  };
}

const todayKey = () => new Date().toISOString().slice(0, 10);

test('create rejects an unauthenticated request', async () => {
  const res = makeRes();
  await create(makeReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 401);
});

test('create rejects the wrong method', async () => {
  const res = makeRes();
  await create(makeReq({ method: 'GET', headers: { authorization: 'Bearer good' } }), res);
  assert.equal(res.statusCode, 405);
});

test('create stores only a hash and returns the token once', async () => {
  db.docs.set('users/user-1/schedule/main', {
    events: [{ id: 'e1', title: 'Math homework', date: todayKey(), start: 960, end: 1020, repeat: 'once' }],
    allDay: [],
    updatedAt: '2026-01-01T00:00:00Z',
  });

  const res = makeRes();
  await create(makeReq({ method: 'POST', headers: { authorization: 'Bearer good' } }), res);
  assert.equal(res.statusCode, 200);

  const token = JSON.parse(res.body).token;
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/);

  const hash = calendar.hashToken(token);
  const index = db.docs.get('calendarSubscriptions/' + hash);
  assert.ok(index, 'index doc written');
  assert.equal(index.uid, 'user-1');
  assert.equal(index.active, true);

  const marker = db.docs.get('users/user-1/integrations/appleCalendar');
  assert.equal(marker.tokenHash, hash);

  /* the feed now serves that user's schedule */
  const feedRes = makeRes();
  await feed(makeReq({ method: 'GET', query: { token } }), feedRes);
  assert.equal(feedRes.statusCode, 200);
  assert.match(feedRes.headers['content-type'], /text\/calendar/);
  assert.match(feedRes.body, /BEGIN:VCALENDAR/);
  assert.match(feedRes.body, /SUMMARY:Math homework/);
});

test('feed returns 404 for an unknown token', async () => {
  const res = makeRes();
  await feed(makeReq({ query: { token: 'Z'.repeat(43) } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, 'Not found');
});

test('revoke removes the lookup so the feed 404s', async () => {
  const token = 'A'.repeat(43);
  const hash = calendar.hashToken(token);
  db.docs.set('calendarSubscriptions/' + hash, { uid: 'user-1', active: true });
  db.docs.set('users/user-1/integrations/appleCalendar', { active: true, tokenHash: hash });

  const before = makeRes();
  await feed(makeReq({ query: { token } }), before);
  assert.equal(before.statusCode, 200);

  const revokeRes = makeRes();
  await revoke(makeReq({ method: 'POST', headers: { authorization: 'Bearer good' } }), revokeRes);
  assert.equal(revokeRes.statusCode, 200);

  const after = makeRes();
  await feed(makeReq({ query: { token } }), after);
  assert.equal(after.statusCode, 404);
});

test('feed supports conditional requests', async () => {
  const token = 'B'.repeat(43);
  const hash = calendar.hashToken(token);
  db.docs.set('calendarSubscriptions/' + hash, { uid: 'user-1', active: true });
  db.docs.set('users/user-1/schedule/main', {
    events: [{ id: 'e2', title: 'Read', date: todayKey(), start: 600, end: 660, repeat: 'once' }],
    allDay: [],
  });

  const first = makeRes();
  await feed(makeReq({ method: 'GET', query: { token } }), first);
  const etag = first.headers.etag;
  assert.ok(etag);

  const second = makeRes();
  await feed(makeReq({ method: 'GET', query: { token }, headers: { 'if-none-match': etag } }), second);
  assert.equal(second.statusCode, 304);
});
