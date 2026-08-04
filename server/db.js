/** Compatibility shim — persistence is Firestore via firebase.js */
export {
  isDbEnabled,
  initDb,
  getDb,
} from './firebase.js';
