/* Tempo reminder sender — scheduled Firebase Function that pushes due reminders via FCM.
   Deploy: npm install (in functions/) then `firebase deploy --only functions`.
   Requires the Blaze (pay-as-you-go) plan for pubsub.schedule triggers. */
const crypto = require('crypto');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const calendar = require('./calendar');
admin.initializeApp();
const db = admin.firestore();

const DAY = 86400000;
const MIN = 60000;
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseUTC = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const minsLabel = (n) => { const h = Math.floor(n / 60), m = n % 60; return (h % 12 || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM'); };

function occurs(e, k) {
  if (e.date === k) return true;
  if (!e.date || e.date > k || e.repeat === 'once') return false;
  if (Array.isArray(e.excludedDates) && e.excludedDates.includes(k)) return false;
  const a = parseUTC(e.date), b = parseUTC(k);
  const bd = new Date(b);
  return e.repeat === 'daily' ||
    (e.repeat === 'weekdays' && bd.getUTCDay() > 0 && bd.getUTCDay() < 6) ||
    (e.repeat === 'weekly' && new Date(a).getUTCDay() === bd.getUTCDay());
}

function resolveEvent(e, k) {
  const o = (e.overrides && e.overrides[k]) || null;
  if (!o) return e;
  const r = Object.assign({}, e, o);
  r.start = o.start !== undefined ? o.start : e.start;
  r.end = o.end !== undefined ? o.end : e.end;
  r.title = o.title !== undefined ? o.title : e.title;
  r.id = e.id; r.date = e.date; r.repeat = e.repeat;
  return r;
}

async function sendDue() {
  const now = Date.now();
  const users = await db.collection('users').get();
  await Promise.all(users.docs.map((u) => processUser(u, now).catch((err) => console.error('Tempo fn user error:', err))));
}

async function processUser(u, now) {
  const uid = u.id;
  const tokens = Object.keys((u.data() && u.data().fcmTokens) || {});
  if (!tokens.length) return;

  const schedule = await db.collection('users').doc(uid).collection('schedule').doc('main').get();
  if (!schedule.exists) return;
  const main = schedule.data();
  const events = Array.isArray(main.events) ? main.events : [];
  if (!events.length) return;

  const nsDoc = await db.collection('users').doc(uid).collection('notificationSettings').doc('main').get();
  const ns = nsDoc.exists ? nsDoc.data() : null;
  if (!ns || ns.enabled !== true) return;
  const lead = Math.max(0, Number(ns.lead) || 0) * MIN;

  /* The device saves tzOffset = getTimezoneOffset() (minutes west of UTC), so local = now - offset. */
  const tzMin = Number(main.tzOffset);
  const localNow = Number.isFinite(tzMin) ? new Date(now - tzMin * MIN) : new Date(now);
  const today = dateKey(localNow);
  const midnight = localNow.getTime() -
    ((localNow.getHours() * 60 + localNow.getMinutes()) * 60 + localNow.getSeconds()) * 1000 -
    localNow.getMilliseconds();

  const sentRef = db.collection('users').doc(uid).collection('sentReminders').doc('main');
  const sentSnap = await sentRef.get();
  const sent = sentSnap.exists && sentSnap.data() ? sentSnap.data() : {};
  const write = {};
  const due = [];

  for (const e of events) {
    if (!occurs(e, today)) continue;
    const r = resolveEvent(e, today);
    const trig = midnight + r.start * MIN - lead;
    if (trig > now || now - trig > 12 * MIN) continue;
    const key = today + '|' + r.id + '|' + lead;
    if (sent[key]) continue;
    write[key] = now;
    if (due.length < 40) due.push(r);
  }

  if (due.length) {
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title: 'Time for ' + due.map((r) => r.title).join(', '),
        body: minsLabel(due[0].start) + ' \u2013 ' + minsLabel(due[0].end),
        id: due.length > 1 ? 'multiple' : due[0].id,
        tag: 'tempo-push',
        url: './'
      }
    });
    const invalid = [];
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument') invalid.push(tokens[i]);
    });
    if (invalid.length) {
      const patch = {};
      invalid.forEach((t) => { patch['fcmTokens.' + t] = admin.firestore.FieldValue.delete(); });
      await db.collection('users').doc(uid).update(patch).catch(() => {});
    }
  }

  if (Object.keys(write).length) {
    for (const key of Object.keys(sent)) {
      if (now - Number(sent[key]) > 30 * DAY) write[key] = admin.firestore.FieldValue.delete();
    }
    await sentRef.set(write, { merge: true }).catch(() => {});
  }
}

/* Every 5 minutes, scan users for blocks starting around now and push a reminder. */
exports.sendReminders = functions.pubsub.schedule('every 5 minutes').timeZone('UTC').onRun(async () => {
  await sendDue();
  return null;
});

/* ---------------------------------------------------------------------------
   Apple Calendar subscription feed
   ---------------------------------------------------------------------------
   One-way sync: Tempo → Apple Calendar. A per-user bearer token maps (via a
   SHA-256 hash index) to a uid; the HTTPS feed regenerates an iCalendar document
   from that user's current schedule on every request. The plaintext token is
   only ever returned once, by createAppleCalendarToken. */

const SUBSCRIPTIONS = 'calendarSubscriptions';

/* Best-effort, per-instance throttle so a leaked or scraped link can't be
   hammered. Real limits come from Cloud Functions' own quotas; this just
   softens abusive bursts. IPs are hashed and never logged. */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;
const rateBuckets = new Map();

function rateLimited(req, nowMs) {
  const raw = String((req.headers && req.headers['x-forwarded-for']) || req.ip || 'unknown').split(',')[0].trim();
  const key = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const recent = (rateBuckets.get(key) || []).filter((t) => nowMs - t < RATE_WINDOW_MS);
  recent.push(nowMs);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return recent.length > RATE_MAX;
}

function requireUid(context) {
  const uid = context && context.auth && context.auth.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in to use Apple Calendar.');
  return uid;
}

/* Generate (or replace) this user's subscription token. Returns the plaintext
   token exactly once; only its hash is persisted. */
exports.createAppleCalendarToken = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const token = calendar.generateToken();
  const hash = calendar.hashToken(token);
  const userRef = db.collection('users').doc(uid).collection('integrations').doc('appleCalendar');
  const existing = await userRef.get();
  const previousHash = existing.exists ? existing.data().tokenHash : null;

  const batch = db.batch();
  if (previousHash && previousHash !== hash) {
    batch.delete(db.collection(SUBSCRIPTIONS).doc(previousHash));
  }
  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  batch.set(db.collection(SUBSCRIPTIONS).doc(hash), { uid, active: true, createdAt });
  batch.set(userRef, { active: true, tokenHash: hash, createdAt });
  await batch.commit();

  return { token };
});

/* Revoke this user's subscription and delete the lookup index. */
exports.revokeAppleCalendarToken = functions.https.onCall(async (data, context) => {
  const uid = requireUid(context);
  const userRef = db.collection('users').doc(uid).collection('integrations').doc('appleCalendar');
  const existing = await userRef.get();
  const hash = existing.exists ? existing.data().tokenHash : null;

  const batch = db.batch();
  if (hash) batch.delete(db.collection(SUBSCRIPTIONS).doc(hash));
  batch.delete(userRef);
  await batch.commit();

  return { ok: true };
});

/* The subscription endpoint Apple Calendar polls. The token is the credential. */
exports.appleCalendarFeed = functions.https.onRequest(async (req, res) => {
  if (rateLimited(req, Date.now())) {
    res.set('Retry-After', '60').status(429).send('Too many requests');
    return;
  }

  let result;
  try {
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
    console.error('Tempo calendar feed error:', (err && err.message) || err);
    result = { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Unable to build calendar' };
  }

  Object.keys(result.headers).forEach((key) => res.set(key, result.headers[key]));
  res.status(result.status).send(result.body);
});

/* Callable helper to send a test push from the web app (settings > Reminders). */
exports.sendTestPush = functions.https.onCall(async (data) => {
  const auth = (data && data.auth) || {};
  const uid = auth.uid || null;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const u = await db.collection('users').doc(uid).get();
  const tokens = Object.keys((u.data() && u.data().fcmTokens) || {});
  if (!tokens.length) throw new functions.https.HttpsError('failed-precondition', 'No push tokens on this account.');
  await admin.messaging().sendEachForMulticast({
    tokens,
    data: {
      title: (data && data.title) || 'Tempo test',
      body: (data && data.body) || 'Your schedule is set \u2014 offline reminders are working.',
      url: './',
      tag: 'tempo-test'
    }
  });
  return { ok: true, sent: tokens.length };
});