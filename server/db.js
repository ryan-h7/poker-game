/** Compatibility shim — persistence is Firestore via firebase.js */
export {
  isDbEnabled,
  isDbConfigured,
  getDbInitError,
  initDb,
  getDb,
} from './firebase.js';
