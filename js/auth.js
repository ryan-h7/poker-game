const AUTH_TOKEN_KEY = 'poker-auth-token';
const AUTH_USER_KEY = 'poker-auth-user';

let currentUser = null;
let healthInfo = null;

async function loadHealth() {
  if (healthInfo !== null) return healthInfo;
  try {
    const res = await fetch('/api/health');
    const data = await res.json().catch(() => ({}));
    healthInfo = {
      db: res.ok && data.db === true,
      passwordReset: res.ok && data.passwordReset === true,
    };
  } catch {
    healthInfo = { db: false, passwordReset: false };
  }
  return healthInfo;
}

export async function checkDbAvailable() {
  const health = await loadHealth();
  return health.db;
}

export async function isPasswordResetAvailable() {
  const health = await loadHealth();
  return health.passwordReset;
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 400 && res.status !== 401) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return { res, data };
}

export function getToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return Boolean(getToken() && currentUser);
}

export function getUser() {
  return currentUser;
}

function saveSession(token, user) {
  currentUser = user;
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    if (user?.displayName) {
      localStorage.setItem('poker-player-name', user.displayName);
    }
  } catch { /* ignore */ }
}

function clearSession() {
  currentUser = null;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch { /* ignore */ }
}

export async function initAuth() {
  try {
    const cached = localStorage.getItem(AUTH_USER_KEY);
    if (cached) currentUser = JSON.parse(cached);
  } catch {
    currentUser = null;
  }

  if (!getToken()) {
    currentUser = null;
    return null;
  }

  try {
    const { res, data } = await apiFetch('/auth/me');
    if (!res.ok || !data.ok) {
      clearSession();
      return null;
    }
    currentUser = data.user;
    try {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(currentUser));
      if (currentUser?.displayName) {
        localStorage.setItem('poker-player-name', currentUser.displayName);
      }
    } catch { /* ignore */ }
    return currentUser;
  } catch {
    return currentUser;
  }
}

export async function register({ email, password, displayName }) {
  const { res, data } = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!data.ok) return data;
  saveSession(data.token, data.user);
  return data;
}

export async function login({ email, password }) {
  const { res, data } = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!data.ok) return data;
  saveSession(data.token, data.user);
  return data;
}

export function logout() {
  clearSession();
}

export async function updateDisplayName(displayName) {
  const { data } = await apiFetch('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  });
  if (!data.ok) return data;
  saveSession(data.token, data.user);
  return data;
}

export async function requestPasswordReset(email) {
  const { data } = await apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return data;
}

export async function resetPassword(token, password) {
  const { data } = await apiFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
  return data;
}

export async function loadSoloGame() {
  if (!isLoggedIn()) return null;
  try {
    const { data } = await apiFetch('/solo/save');
    if (!data.ok || !data.state?.sessionActive) return null;
    return data.state;
  } catch {
    return null;
  }
}

export async function saveSoloGame(state) {
  if (!isLoggedIn() || !state) return;
  try {
    await apiFetch('/solo/save', {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
  } catch {
    /* ignore — sessionStorage still has a copy */
  }
}

export async function clearSoloGame() {
  if (!isLoggedIn()) return;
  try {
    await apiFetch('/solo/save', { method: 'DELETE' });
  } catch { /* ignore */ }
}

export async function fetchStats() {
  if (!isLoggedIn()) return null;
  try {
    const { data } = await apiFetch('/stats');
    return data.ok ? data.stats : null;
  } catch {
    return null;
  }
}

export async function recordHand(handStats) {
  if (!isLoggedIn() || !handStats) return;
  try {
    await apiFetch('/stats/hand', {
      method: 'POST',
      body: JSON.stringify(handStats),
    });
  } catch {
    /* ignore */
  }
}

export function formatStats(stats) {
  if (!stats) return null;
  const hands = stats.hands_played || 0;
  const pct = (n) => (hands > 0 ? Math.round((n / hands) * 100) : 0);
  const profit = Number(stats.total_profit) || 0;
  return {
    hands,
    winPct: pct(stats.hands_won || 0),
    profit,
    profitLabel: profit >= 0 ? `+$${profit.toLocaleString()}` : `-$${Math.abs(profit).toLocaleString()}`,
    vpipPct: pct(stats.vpip_count || 0),
    pfrPct: pct(stats.pfr_count || 0),
    wtsdPct: pct(stats.showdown_count || 0),
    wsdPct: (stats.showdown_count || 0) > 0
      ? Math.round(((stats.showdown_wins || 0) / stats.showdown_count) * 100)
      : 0,
  };
}
