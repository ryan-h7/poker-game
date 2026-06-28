import { Router } from 'express';
import { isDbEnabled } from './db.js';
import { isResetEmailConfigured } from './mail.js';
import {
  authMiddleware,
  registerUser,
  loginUser,
  getUserById,
  updateUserDisplayName,
  requestPasswordReset,
  resetPasswordWithToken,
  getAppBaseUrl,
} from './auth.js';
import { query } from './db.js';

const router = Router();

router.get('/health', (_, res) => {
  res.json({
    ok: true,
    db: isDbEnabled(),
    passwordReset: isDbEnabled() && isResetEmailConfigured(),
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
    const result = await registerUser(req.body || {});
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
    const result = await query(
      'SELECT state_json, updated_at FROM solo_saves WHERE user_id = $1',
      [req.user.id],
    );
    const row = result.rows[0];
    if (!row) {
      res.json({ ok: true, state: null });
      return;
    }
    res.json({ ok: true, state: row.state_json, updatedAt: row.updated_at });
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
    await query(
      `INSERT INTO solo_saves (user_id, state_json, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id)
       DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = now()`,
      [req.user.id, state],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('solo save error', err);
    res.status(500).json({ ok: false, error: 'Could not save game.' });
  }
});

router.delete('/solo/save', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM solo_saves WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('solo delete error', err);
    res.status(500).json({ ok: false, error: 'Could not clear saved game.' });
  }
});

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT hands_played, hands_won, total_profit, vpip_count, pfr_count,
              showdown_count, showdown_wins
       FROM user_stats WHERE user_id = $1`,
      [req.user.id],
    );
    const stats = result.rows[0] || {
      hands_played: 0,
      hands_won: 0,
      total_profit: 0,
      vpip_count: 0,
      pfr_count: 0,
      showdown_count: 0,
      showdown_wins: 0,
    };
    res.json({ ok: true, stats });
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
    await query(
      `INSERT INTO user_stats (user_id, hands_played, hands_won, total_profit,
                               vpip_count, pfr_count, showdown_count, showdown_wins)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         hands_played = user_stats.hands_played + 1,
         hands_won = user_stats.hands_won + EXCLUDED.hands_won,
         total_profit = user_stats.total_profit + EXCLUDED.total_profit,
         vpip_count = user_stats.vpip_count + EXCLUDED.vpip_count,
         pfr_count = user_stats.pfr_count + EXCLUDED.pfr_count,
         showdown_count = user_stats.showdown_count + EXCLUDED.showdown_count,
         showdown_wins = user_stats.showdown_wins + EXCLUDED.showdown_wins`,
      [
        req.user.id,
        won ? 1 : 0,
        profitInt,
        vpip ? 1 : 0,
        pfr ? 1 : 0,
        sawShowdown ? 1 : 0,
        wonShowdown ? 1 : 0,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('stats hand error', err);
    res.status(500).json({ ok: false, error: 'Could not record hand stats.' });
  }
});

export default router;
