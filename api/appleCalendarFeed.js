/*  GET /api/appleCalendarFeed?token=…
 *
 *  The subscription endpoint Apple Calendar polls. The bearer token IS the
 *  credential: it is hashed and matched against a Firestore index, then the
 *  owner's current schedule is rendered into iCalendar on every request.
 *  No auth header is expected here.
 */
'use strict';

const crypto = require('crypto');
const calendar = require('../functions/calendar.js');
const { getDb } = require('./_firebaseAdmin.js');

const SUBSCRIPTIONS = 'calendarSubscriptions';

/* Best-effort, per-instance throttle. Real limits come from Vercel; this just
   softens abusive bursts. Client IPs are hashed and never logged. */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;
const rateBuckets = new Map();

function rateLimited(req, nowMs) {
  const raw = String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
  const key = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const recent = (rateBuckets.get(key) || []).filter((t) => nowMs - t < RATE_WINDOW_MS);
  recent.push(nowMs);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return recent.length > RATE_MAX;
}

module.exports = async function handler(req, res) {
  if (rateLimited(req, Date.now())) {
    res.setHeader('Retry-After', '60');
    res.statusCode = 429;
    res.end('Too many requests');
    return;
  }

  let result;
  try {
    const db = getDb();
    result = await calendar.handleFeedRequest({
      method: req.method,
      token: req.query && req.query.token,
      ifNoneMatch: req.headers && req.headers['if-none-match'],
      lookupSubscription: async (hash) => {
        const snap = await db.collection(SUBSCRIPTIONS).doc(hash).get();
        const data = snap.exists ? snap.data() : null;
        return data && data.active === true && typeof data.uid === 'string' ? { uid: data.uid } : null;
      },
      getSchedule: async (uid) => {
        const snap = await db.collection('users').doc(uid).collection('schedule').doc('main').get();
        return snap.exists ? snap.data() : null;
      },
      now: new Date(),
    });
  } catch (err) {
    /* Never echo the token or any user data into logs. */
    console.error('appleCalendarFeed error:', (err && err.message) || err);
    result = {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      body: 'Unable to build calendar',
    };
  }

  Object.keys(result.headers).forEach((k) => res.setHeader(k, result.headers[k]));
  res.statusCode = result.status;
  if (req.method === 'HEAD') res.end();
  else res.end(result.body);
};
