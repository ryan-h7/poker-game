import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let db = null;
let initAttempted = false;
let initError = null;
let dbReady = false;

function stripWrappingQuotes(value) {
  const s = String(value || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function parseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    const parsed = JSON.parse(stripWrappingQuotes(rawJson));
    if (parsed.private_key) {
      parsed.private_key = stripWrappingQuotes(parsed.private_key).replace(/\\n/g, '\n');
    }
    return parsed;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;

  privateKey = stripWrappingQuotes(privateKey).replace(/\\n/g, '\n');
  return {
    project_id: stripWrappingQuotes(projectId),
    client_email: stripWrappingQuotes(clientEmail),
    private_key: privateKey,
  };
}

/** True when Firebase env vars are present (may still fail to connect). */
export function isDbConfigured() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || (process.env.FIREBASE_PROJECT_ID
      && process.env.FIREBASE_CLIENT_EMAIL
      && process.env.FIREBASE_PRIVATE_KEY),
  );
}

/** True only after a successful Firestore connection at boot. */
export function isDbEnabled() {
  return dbReady;
}

export function getDb() {
  if (!isDbConfigured()) return null;
  if (db) return db;
  if (initAttempted && initError) throw initError;

  initAttempted = true;
  try {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      throw new Error('Firebase credentials are incomplete.');
    }
    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    }
    db = getFirestore();
    return db;
  } catch (err) {
    initError = err;
    dbReady = false;
    throw err;
  }
}

export async function initDb() {
  if (!isDbConfigured()) return false;
  try {
    const firestore = getDb();
    // Touch Firestore so bad credentials fail at boot, not on first request.
    await firestore.collection('users').limit(1).get();
    dbReady = true;
    return true;
  } catch (err) {
    dbReady = false;
    initError = err;
    throw err;
  }
}

export function userRef(userId) {
  return getDb().collection('users').doc(userId);
}

export function emailRef(email) {
  const id = String(email || '').trim().toLowerCase().replace(/\//g, '_');
  return getDb().collection('emailByEmail').doc(id);
}

export function statsRef(userId) {
  return userRef(userId).collection('meta').doc('stats');
}

export function soloSaveRef(userId) {
  return userRef(userId).collection('meta').doc('soloSave');
}

export function tokenRef(kind, token) {
  return getDb().collection('tokens').doc(`${kind}_${token}`);
}

export function emptyStats() {
  return {
    handsPlayed: 0,
    handsWon: 0,
    totalProfit: 0,
    vpipCount: 0,
    pfrCount: 0,
    showdownCount: 0,
    showdownWins: 0,
  };
}

export function statsToApi(data) {
  const s = data || {};
  return {
    hands_played: s.handsPlayed || 0,
    hands_won: s.handsWon || 0,
    total_profit: s.totalProfit || 0,
    vpip_count: s.vpipCount || 0,
    pfr_count: s.pfrCount || 0,
    showdown_count: s.showdownCount || 0,
    showdown_wins: s.showdownWins || 0,
  };
}

export async function deleteTokensForUser(userId) {
  const snap = await getDb().collection('tokens').where('userId', '==', userId).get();
  if (snap.empty) return;
  const batch = getDb().batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
}

export async function deleteUserData(userId, email) {
  const firestore = getDb();
  await deleteTokensForUser(userId);
  const batch = firestore.batch();
  batch.delete(statsRef(userId));
  batch.delete(soloSaveRef(userId));
  batch.delete(userRef(userId));
  if (email) batch.delete(emailRef(email));
  await batch.commit();
}
