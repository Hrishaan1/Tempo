/*  POST /api/createAppleCalendarToken
 *
 *  Auth: Firebase ID token in the Authorization header. Mints (or replaces) the
 *  caller's private subscription token, persists only its SHA-256 hash, and
 *  returns the plaintext token exactly once.
 */
'use strict';

const calendar = require('../functions/calendar.js');
const { getDb, verifyBearer, serverTimestamp } = require('./_firebaseAdmin.js');
const { sendJson } = require('./_http.js');

const SUBSCRIPTIONS = 'calendarSubscriptions';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  let uid;
  try {
    uid = await verifyBearer(req);
  } catch (err) {
    return sendJson(res, err.status || 401, { error: err.message });
  }

  try {
    const db = getDb();
    const token = calendar.generateToken();
    const hash = calendar.hashToken(token);
    const userRef = db.collection('users').doc(uid).collection('integrations').doc('appleCalendar');
    const existing = await userRef.get();
    const previousHash = existing.exists ? existing.data().tokenHash : null;

    const batch = db.batch();
    if (previousHash && previousHash !== hash) {
      batch.delete(db.collection(SUBSCRIPTIONS).doc(previousHash));
    }
    const createdAt = serverTimestamp();
    batch.set(db.collection(SUBSCRIPTIONS).doc(hash), { uid, active: true, createdAt });
    batch.set(userRef, { active: true, tokenHash: hash, createdAt });
    await batch.commit();

    return sendJson(res, 200, { token });
  } catch (err) {
    console.error('createAppleCalendarToken error:', (err && err.message) || err);
    return sendJson(res, 500, { error: 'Could not create a subscription link. Please try again.' });
  }
};
