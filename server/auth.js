import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'crypto';
import {
  getDb,
  userRef,
  emailRef,
  statsRef,
  tokenRef,
  emptyStats,
  deleteTokensForUser,
  deleteUserData,
} from './firebase.js';
import {
  isEmailConfigured,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './mail.js';

const TOKEN_TTL = '30d';
const RESET_TOKEN_HOURS = 1;
const VERIFY_TOKEN_HOURS = 24;

class DuplicateEmailError extends Error {
  constructor() {
    super('An account with that email already exists.');
    this.code = 'ALREADY_EXISTS';
  }
}

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

function formatUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified !== false,
  };
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, displayName: user.displayName },
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

async function loadUserById(userId) {
  const snap = await userRef(userId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadUserByEmail(email) {
  const mapSnap = await emailRef(email).get();
  if (!mapSnap.exists) return null;
  const { userId } = mapSnap.data();
  if (!userId) return null;
  return loadUserById(userId);
}

async function createVerificationToken(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_HOURS * 60 * 60 * 1000).toISOString();
  await deleteTokensForUser(userId);
  await tokenRef('verify', token).set({
    type: 'verify',
    userId,
    expiresAt,
    createdAt: new Date().toISOString(),
  });
  return token;
}

async function sendUserVerificationEmail(user, appBaseUrl) {
  const token = await createVerificationToken(user.id);
  const verifyUrl = `${appBaseUrl}/?verify=${token}`;
  return sendVerificationEmail({
    to: user.email,
    verifyUrl,
    displayName: user.displayName,
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
  const userId = randomUUID();
  const db = getDb();

  try {
    await db.runTransaction(async (tx) => {
      const emailDoc = await tx.get(emailRef(normalizedEmail));
      if (emailDoc.exists) throw new DuplicateEmailError();

      tx.set(userRef(userId), {
        email: normalizedEmail,
        passwordHash,
        displayName: name,
        emailVerified,
        createdAt: new Date().toISOString(),
      });
      tx.set(emailRef(normalizedEmail), { userId });
      tx.set(statsRef(userId), emptyStats());
    });

    const user = {
      id: userId,
      email: normalizedEmail,
      displayName: name,
      emailVerified,
    };

    if (requireEmail) {
      const sent = await sendUserVerificationEmail(user, appBaseUrl);
      if (!sent?.ok) {
        await deleteUserData(userId, normalizedEmail);
        return { ok: false, error: sent?.error || 'Could not send verification email. Try again later.' };
      }
      return {
        ok: true,
        needsVerification: true,
        email: user.email,
        message: 'Account created. Check your email for a verification link before signing in.',
      };
    }

    return {
      ok: true,
      token: signToken(user),
      user: formatUser(user),
    };
  } catch (err) {
    if (err.code === 'ALREADY_EXISTS' || err instanceof DuplicateEmailError) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    throw err;
  }
}

export async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const user = await loadUserByEmail(normalizedEmail);
  if (!user) return { ok: false, error: 'Invalid email or password.' };

  const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!valid) return { ok: false, error: 'Invalid email or password.' };

  if (user.emailVerified === false) {
    return {
      ok: false,
      needsVerification: true,
      email: user.email,
      error: 'Verify your email before signing in. Check your inbox for the link, or resend it below.',
    };
  }

  return {
    ok: true,
    token: signToken(user),
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

  const user = await loadUserByEmail(normalizedEmail);
  if (!user || user.emailVerified !== false) {
    return {
      ok: true,
      message: 'If that account needs verification, a new link has been sent.',
    };
  }

  const sent = await sendUserVerificationEmail(user, appBaseUrl);
  if (!sent?.ok) {
    return { ok: false, error: sent?.error || 'Could not send verification email. Try again later.' };
  }

  return {
    ok: true,
    message: 'If that account needs verification, a new link has been sent.',
  };
}

export async function verifyEmailWithToken(token) {
  const verifyTokenValue = String(token || '').trim();
  if (!verifyTokenValue) return { ok: false, error: 'Invalid verification link.' };

  const tokenSnap = await tokenRef('verify', verifyTokenValue).get();
  if (!tokenSnap.exists) {
    return { ok: false, error: 'This verification link is invalid or has expired.' };
  }

  const tokenData = tokenSnap.data();
  if (!tokenData?.userId || new Date(tokenData.expiresAt) < new Date()) {
    return { ok: false, error: 'This verification link is invalid or has expired.' };
  }

  const user = await loadUserById(tokenData.userId);
  if (!user) {
    return { ok: false, error: 'This verification link is invalid or has expired.' };
  }

  if (user.emailVerified === false) {
    await userRef(user.id).update({ emailVerified: true });
  }
  await deleteTokensForUser(user.id);

  const verified = { ...user, emailVerified: true };
  return {
    ok: true,
    token: signToken(verified),
    user: formatUser(verified),
    message: 'Email verified. You are signed in.',
  };
}

export async function getUserById(userId) {
  const user = await loadUserById(userId);
  if (!user) return null;
  if (user.emailVerified === false) return null;
  return formatUser(user);
}

export async function updateUserDisplayName(userId, displayName) {
  const name = String(displayName || '').trim().slice(0, 16);
  if (!name) return { ok: false, error: 'Enter a display name.' };

  const user = await loadUserById(userId);
  if (!user || user.emailVerified === false) {
    return { ok: false, error: 'Account not found.' };
  }

  await userRef(userId).update({ displayName: name });
  const updated = { ...user, displayName: name };
  return { ok: true, token: signToken(updated), user: formatUser(updated) };
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

  const user = await loadUserByEmail(normalizedEmail);
  if (!user || user.emailVerified === false) {
    return {
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    };
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000).toISOString();

  await deleteTokensForUser(user.id);
  await tokenRef('reset', token).set({
    type: 'reset',
    userId: user.id,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  const resetUrl = `${appBaseUrl}/?reset=${token}`;
  const sent = await sendPasswordResetEmail({ to: normalizedEmail, resetUrl });
  if (!sent?.ok) {
    return { ok: false, error: sent?.error || 'Could not send reset email. Try again later.' };
  }

  return {
    ok: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  };
}

export async function deleteUserAccount(userId, password) {
  const user = await loadUserById(userId);
  if (!user) return { ok: false, error: 'Account not found.' };

  const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!valid) return { ok: false, error: 'Incorrect password.' };

  await deleteUserData(userId, user.email);
  return { ok: true, message: 'Account deleted.' };
}

export async function resetPasswordWithToken(token, password) {
  const resetToken = String(token || '').trim();
  if (!resetToken) return { ok: false, error: 'Invalid reset link.' };
  if (String(password || '').length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }

  const tokenSnap = await tokenRef('reset', resetToken).get();
  if (!tokenSnap.exists) {
    return { ok: false, error: 'This reset link is invalid or has expired.' };
  }

  const tokenData = tokenSnap.data();
  if (!tokenData?.userId || new Date(tokenData.expiresAt) < new Date()) {
    return { ok: false, error: 'This reset link is invalid or has expired.' };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await userRef(tokenData.userId).update({ passwordHash });
  await deleteTokensForUser(tokenData.userId);

  return { ok: true, message: 'Password updated. You can sign in with your new password.' };
}
