/** Compatibility shim — persistence is Firestore via firebase.js */
export {
  isDbEnabled,
  isDbConfigured,
  initDb,
  getDb,
} from './firebase.js';
