/*  POST /api/revokeAppleCalendarToken
 *
 *  Auth: Firebase ID token in the Authorization header. Deletes the caller's
 *  subscription index entry and private marker, so the old feed URL returns 404.
 */
'use strict';

const { getDb, verifyBearer } = require('./_firebaseAdmin.js');
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
    const userRef = db.collection('users').doc(uid).collection('integrations').doc('appleCalendar');
    const existing = await userRef.get();
    const hash = existing.exists ? existing.data().tokenHash : null;

    const batch = db.batch();
    if (hash) batch.delete(db.collection(SUBSCRIPTIONS).doc(hash));
    batch.delete(userRef);
    await batch.commit();

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('revokeAppleCalendarToken error:', (err && err.message) || err);
    return sendJson(res, 500, { error: 'Could not revoke the link. Please try again.' });
  }
};
