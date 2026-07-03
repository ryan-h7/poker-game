import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query } from './db.js';
import {
  isEmailConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './mail.js';

const TOKEN_TTL = '30d';
const RESET_TOKEN_HOURS = 1;
const VERIFY_TOKEN_HOURS = 24;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  return secret;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeDisplayName(name, fallback = 'Player') {
  const trimmed = String(name || '').trim().slice(0, 16);
  return trimmed || fallback;
}

function formatUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerified: row.email_verified !== false,
  };
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

async function createVerificationToken(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_HOURS * 60 * 60 * 1000);
  await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
  await query(
    `INSERT INTO email_verification_tokens (token, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token, userId, expiresAt],
  );
  return token;
}

async function sendUserVerificationEmail(user, appBaseUrl) {
  const token = await createVerificationToken(user.id);
  const verifyUrl = `${appBaseUrl}/?verify=${token}`;
  return sendVerificationEmail({
    to: user.email,
    verifyUrl,
    displayName: user.display_name,
  });
}

export async function registerUser({ email, password, displayName }, appBaseUrl) {
  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (String(password || '').length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }

  const requireEmail = isEmailConfigured();
  if (requireEmail && !appBaseUrl) {
    return { ok: false, error: 'Account email is not fully configured on this server.' };
  }

  const name = normalizeDisplayName(displayName, normalizedEmail.split('@')[0] || 'Player');
  const passwordHash = await bcrypt.hash(password, 10);
  const emailVerified = !requireEmail;

  try {
    const result = await query(
      `INSERT INTO users (email, password_hash, display_name, email_verified)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, email_verified`,
      [normalizedEmail, passwordHash, name, emailVerified],
    );
    const user = result.rows[0];
    await query('INSERT INTO user_stats (user_id) VALUES ($1)', [user.id]);

    if (requireEmail) {
      const sent = await sendUserVerificationEmail(user, appBaseUrl);
      if (!sent) {
        await query('DELETE FROM users WHERE id = $1', [user.id]);
        return { ok: false, error: 'Could not send verification email. Try again later.' };
      }
      return {
        ok: true,
        needsVerification: true,
        email: user.email,
        message: 'Account created. Check your email for a verification link before signing in.',
      };
    }

    const token = signToken(user);
    return {
      ok: true,
      token,
      user: formatUser(user),
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
    'SELECT id, email, display_name, password_hash, email_verified FROM users WHERE email = $1',
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user) return { ok: false, error: 'Invalid email or password.' };

  const valid = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!valid) return { ok: false, error: 'Invalid email or password.' };

  if (user.email_verified === false) {
    return {
      ok: false,
      needsVerification: true,
      email: user.email,
      error: 'Verify your email before signing in. Check your inbox for the link, or resend it below.',
    };
  }

  const token = signToken(user);
  return {
    ok: true,
    token,
    user: formatUser(user),
  };
}

export async function resendVerificationEmail(email, appBaseUrl) {
  if (!isEmailConfigured()) {
    return { ok: false, error: 'Email verification is not configured on this server.' };
  }

  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const result = await query(
    'SELECT id, email, display_name, email_verified FROM users WHERE email = $1',
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user || user.email_verified !== false) {
    return {
      ok: true,
      message: 'If that account needs verification, a new link has been sent.',
    };
  }

  const sent = await sendUserVerificationEmail(user, appBaseUrl);
  if (!sent) {
    return { ok: false, error: 'Could not send verification email. Try again later.' };
  }

  return {
    ok: true,
    message: 'If that account needs verification, a new link has been sent.',
  };
}

export async function verifyEmailWithToken(token) {
  const verifyTokenValue = String(token || '').trim();
  if (!verifyTokenValue) return { ok: false, error: 'Invalid verification link.' };

  const result = await query(
    `SELECT t.user_id, t.expires_at, u.email, u.display_name, u.email_verified
     FROM email_verification_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = $1`,
    [verifyTokenValue],
  );
  const row = result.rows[0];
  if (!row || new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'This verification link is invalid or has expired.' };
  }

  if (row.email_verified === false) {
    await query('UPDATE users SET email_verified = true WHERE id = $1', [row.user_id]);
  }
  await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [row.user_id]);

  const user = {
    id: row.user_id,
    email: row.email,
    display_name: row.display_name,
    email_verified: true,
  };
  const sessionToken = signToken(user);
  return {
    ok: true,
    token: sessionToken,
    user: formatUser(user),
    message: 'Email verified. You are signed in.',
  };
}

export async function getUserById(userId) {
  const result = await query(
    'SELECT id, email, display_name, email_verified FROM users WHERE id = $1',
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  if (user.email_verified === false) return null;
  return formatUser(user);
}

export async function updateUserDisplayName(userId, displayName) {
  const name = String(displayName || '').trim().slice(0, 16);
  if (!name) return { ok: false, error: 'Enter a display name.' };

  const result = await query(
    `UPDATE users SET display_name = $1 WHERE id = $2 AND email_verified = true
     RETURNING id, email, display_name, email_verified`,
    [name, userId],
  );
  const user = result.rows[0];
  if (!user) return { ok: false, error: 'Account not found.' };

  return { ok: true, token: signToken(user), user: formatUser(user) };
}

export function getAppBaseUrl(req) {
  if (process.env.APP_BASE_URL) {
    return String(process.env.APP_BASE_URL).replace(/\/$/, '');
  }
  const host = req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

export async function requestPasswordReset(email, appBaseUrl) {
  if (!isEmailConfigured()) {
    return { ok: false, error: 'Password reset email is not configured on this server.' };
  }

  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const result = await query(
    'SELECT id, email_verified FROM users WHERE email = $1',
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user || user.email_verified === false) {
    return {
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    };
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);

  await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
  await query(
    `INSERT INTO password_reset_tokens (token, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token, user.id, expiresAt],
  );

  const resetUrl = `${appBaseUrl}/?reset=${token}`;
  const sent = await sendPasswordResetEmail({ to: normalizedEmail, resetUrl });
  if (!sent) {
    return { ok: false, error: 'Could not send reset email. Try again later.' };
  }

  return {
    ok: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  };
}

export async function resetPasswordWithToken(token, password) {
  const resetToken = String(token || '').trim();
  if (!resetToken) return { ok: false, error: 'Invalid reset link.' };
  if (String(password || '').length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }

  const result = await query(
    `SELECT t.user_id, t.expires_at
     FROM password_reset_tokens t
     WHERE t.token = $1`,
    [resetToken],
  );
  const row = result.rows[0];
  if (!row || new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'This reset link is invalid or has expired.' };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
  await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [row.user_id]);

  return { ok: true, message: 'Password updated. You can sign in with your new password.' };
}
