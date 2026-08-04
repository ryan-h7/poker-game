/** List registered accounts. Usage: set Firebase env vars then run `node scripts/list-users.js` */
import { initDb, isDbEnabled, getDb, statsRef, statsToApi } from '../server/firebase.js';

if (!isDbEnabled()) {
  console.error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT_JSON).');
  process.exit(1);
}

try {
  await initDb();
  const snap = await getDb().collection('users').orderBy('createdAt', 'desc').get();
  if (snap.empty) {
    console.log('No registered accounts yet.');
  } else {
    const rows = [];
    for (const doc of snap.docs) {
      const u = doc.data();
      const statsSnap = await statsRef(doc.id).get();
      const stats = statsToApi(statsSnap.exists ? statsSnap.data() : null);
      rows.push({
        email: u.email,
        display_name: u.displayName,
        created_at: u.createdAt,
        hands_played: stats.hands_played,
        total_profit: stats.total_profit,
      });
    }
    console.table(rows);
    console.log(`\n${rows.length} account(s) total.`);
  }
} catch (err) {
  console.error('Could not connect:', err.message);
  process.exit(1);
}
