import { isDbEnabled, isDbConfigured, getDbInitError } from './db.js';
import { isEmailConfigured } from './mail.js';
import {
  authMiddleware,
  registerUser,
  loginUser,
  getUserById,
  updateUserDisplayName,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyEmailWithToken,
  resendVerificationEmail,
  deleteUserAccount,
  getAppBaseUrl,
} from './auth.js';
import {
  soloSaveRef,
  statsRef,
  emptyStats,
  statsToApi,
} from './firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { Router } from 'express';

const router = Router();

router.get('/health', (_, res) => {
  const db = isDbEnabled();
  const configured = isDbConfigured();
  const email = db && isEmailConfigured();
  res.json({
    ok: true,
    db,
    dbConfigured: configured,
    dbError: db || !configured ? undefined : getDbInitError(),
    email,
    passwordReset: email,
    emailVerification: email,
  });
});

function dbRequired(req, res, next) {
  if (!isDbEnabled()) {
    res.status(503).json({ ok: false, error: 'Account features are not configured on this server.' });
    return;
  }
  next();
}

router.use(dbRequired);

router.post('/auth/register', async (req, res) => {
  try {
    const result = await registerUser(req.body || {}, getAppBaseUrl(req));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ ok: false, error: 'Could not create account.' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const result = await loginUser(req.body || {});
    res.status(result.ok ? 200 : 401).json(result);
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ ok: false, error: 'Could not sign in.' });
  }
});

router.post('/auth/verify-email', async (req, res) => {
  try {
    const result = await verifyEmailWithToken(req.body?.token);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('verify email error', err);
    res.status(500).json({ ok: false, error: 'Could not verify email.' });
  }
});

router.post('/auth/resend-verification', async (req, res) => {
  try {
    const result = await resendVerificationEmail(req.body?.email, getAppBaseUrl(req));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('resend verification error', err);
    res.status(500).json({ ok: false, error: 'Could not resend verification email.' });
  }
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Account not found.' });
      return;
    }
    res.json({ ok: true, user });
  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ ok: false, error: 'Could not load account.' });
  }
});

router.patch('/auth/profile', authMiddleware, async (req, res) => {
  try {
    const result = await updateUserDisplayName(req.user.id, req.body?.displayName);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('profile update error', err);
    res.status(500).json({ ok: false, error: 'Could not update profile.' });
  }
});

router.delete('/auth/account', authMiddleware, async (req, res) => {
  try {
    const result = await deleteUserAccount(req.user.id, req.body?.password);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('delete account error', err);
    res.status(500).json({ ok: false, error: 'Could not delete account.' });
  }
});

router.post('/auth/forgot-password', async (req, res) => {
  try {
    const result = await requestPasswordReset(req.body?.email, getAppBaseUrl(req));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('forgot password error', err);
    res.status(500).json({ ok: false, error: 'Could not request password reset.' });
  }
});

router.post('/auth/reset-password', async (req, res) => {
  try {
    const result = await resetPasswordWithToken(req.body?.token, req.body?.password);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('reset password error', err);
    res.status(500).json({ ok: false, error: 'Could not reset password.' });
  }
});

router.get('/solo/save', authMiddleware, async (req, res) => {
  try {
    const snap = await soloSaveRef(req.user.id).get();
    if (!snap.exists) {
      res.json({ ok: true, state: null });
      return;
    }
    const data = snap.data();
    res.json({ ok: true, state: data.state ?? null, updatedAt: data.updatedAt });
  } catch (err) {
    console.error('solo load error', err);
    res.status(500).json({ ok: false, error: 'Could not load saved game.' });
  }
});

router.put('/solo/save', authMiddleware, async (req, res) => {
  try {
    const state = req.body?.state;
    if (!state || state.v !== 1 || !state.sessionActive) {
      res.status(400).json({ ok: false, error: 'Invalid solo game state.' });
      return;
    }
    await soloSaveRef(req.user.id).set({
      state,
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('solo save error', err);
    res.status(500).json({ ok: false, error: 'Could not save game.' });
  }
});

router.delete('/solo/save', authMiddleware, async (req, res) => {
  try {
    await soloSaveRef(req.user.id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('solo delete error', err);
    res.status(500).json({ ok: false, error: 'Could not clear saved game.' });
  }
});

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const snap = await statsRef(req.user.id).get();
    res.json({ ok: true, stats: statsToApi(snap.exists ? snap.data() : emptyStats()) });
  } catch (err) {
    console.error('stats load error', err);
    res.status(500).json({ ok: false, error: 'Could not load stats.' });
  }
});

router.post('/stats/hand', authMiddleware, async (req, res) => {
  try {
    const {
      profit = 0,
      won = false,
      vpip = false,
      pfr = false,
      sawShowdown = false,
      wonShowdown = false,
    } = req.body || {};

    const profitInt = Number.parseInt(profit, 10) || 0;
    const ref = statsRef(req.user.id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        handsPlayed: 1,
        handsWon: won ? 1 : 0,
        totalProfit: profitInt,
        vpipCount: vpip ? 1 : 0,
        pfrCount: pfr ? 1 : 0,
        showdownCount: sawShowdown ? 1 : 0,
        showdownWins: wonShowdown ? 1 : 0,
      });
    } else {
      await ref.update({
        handsPlayed: FieldValue.increment(1),
        handsWon: FieldValue.increment(won ? 1 : 0),
        totalProfit: FieldValue.increment(profitInt),
        vpipCount: FieldValue.increment(vpip ? 1 : 0),
        pfrCount: FieldValue.increment(pfr ? 1 : 0),
        showdownCount: FieldValue.increment(sawShowdown ? 1 : 0),
        showdownWins: FieldValue.increment(wonShowdown ? 1 : 0),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('stats hand error', err);
    res.status(500).json({ ok: false, error: 'Could not record hand stats.' });
  }
});

export default router;
