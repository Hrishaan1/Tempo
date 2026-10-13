/*  Shared Firestore/Firebase Admin access for the Vercel serverless routes.
 *
 *  Credentials come from the FIREBASE_SERVICE_ACCOUNT environment variable: the
 *  raw JSON of a Firebase service-account key (Project settings → Service
 *  accounts → Generate new private key). Never commit that key.
 */
'use strict';

const admin = require('firebase-admin');

let ready = false;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed.private_key === 'string' && parsed.private_key.includes('\\n')) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed && parsed.project_id && parsed.private_key ? parsed : null;
  } catch (err) {
    return null;
  }
}

function init() {
  if (ready || admin.apps.length) { ready = true; return; }
  const account = parseServiceAccount();
  if (!account) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing or invalid.');
  }
  admin.initializeApp({ credential: admin.credential.cert(account), projectId: account.project_id });
  ready = true;
}

function getDb() {
  init();
  return admin.firestore();
}

async function verifyBearer(req) {
  init();
  const header = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    const err = new Error('Sign in to use Apple Calendar.');
    err.status = 401;
    throw err;
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(match[1]);
  } catch (cause) {
    const err = new Error('Your session expired — sign in again.');
    err.status = 401;
    throw err;
  }
  if (!decoded || !decoded.uid) {
    const err = new Error('Invalid sign-in token.');
    err.status = 401;
    throw err;
  }
  return decoded.uid;
}

module.exports = { getDb, verifyBearer, serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() };
