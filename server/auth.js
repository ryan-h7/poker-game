import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const TOKEN_TTL = '30d';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  return secret;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeDisplayName(name, email) {
  const trimmed = String(name || '').trim().slice(0, 16);
  if (trimmed) return trimmed;
  return email.split('@')[0].slice(0, 16) || 'Player';
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, displayName: user.display_name },
    jwtSecret(),
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyToken(token) {
  const payload = jwt.verify(token, jwtSecret());
  return {
    id: payload.sub,
    email: payload.email,
    displayName: payload.displayName,
  };
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: 'Not authenticated.' });
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid or expired session.' });
  }
}

export async function registerUser({ email, password, displayName }) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (String(password || '').length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }

  const name = normalizeDisplayName(displayName, normalizedEmail);
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [normalizedEmail, passwordHash, name],
    );
    const user = result.rows[0];
    await query('INSERT INTO user_stats (user_id) VALUES ($1)', [user.id]);
    const token = signToken(user);
    return {
      ok: true,
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    };
  } catch (err) {
    if (err.code === '23505') {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    throw err;
  }
}

export async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const result = await query(
    'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user) return { ok: false, error: 'Invalid email or password.' };

  const valid = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!valid) return { ok: false, error: 'Invalid email or password.' };

  const token = signToken(user);
  return {
    ok: true,
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name },
  };
}

export async function getUserById(userId) {
  const result = await query(
    'SELECT id, email, display_name FROM users WHERE id = $1',
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  return { id: user.id, email: user.email, displayName: user.display_name };
}
