import { Router } from 'express';
import {
  listRoster,
  retireAccount,
  reactivateAccount,
  listOpenGaps,
  dismissGapMonth,
  reopenGapMonth,
} from '../services/accountRoster.js';

const router = Router();

// GET /api/account-roster — the full roster with status
router.get('/', (req, res, next) => {
  try {
    const { platform } = req.query;
    const accounts = listRoster(platform || null);
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/account-roster/retire — { accountName, platform, note? } → 'retired'
router.post('/retire', (req, res, next) => {
  try {
    const { accountName, platform, note } = req.body;
    if (!accountName || !platform) {
      return res.status(400).json({ error: 'accountName och platform krävs.' });
    }
    retireAccount(accountName, platform, note || null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/account-roster/reactivate — { accountName, platform } → 'active'
router.post('/reactivate', (req, res, next) => {
  try {
    const { accountName, platform } = req.body;
    if (!accountName || !platform) {
      return res.status(400).json({ error: 'accountName och platform krävs.' });
    }
    reactivateAccount(accountName, platform);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/account-roster/gaps — open gaps, grouped per account.
// New gaps are written exclusively by the import transaction (registerGaps,
// INSERT OR IGNORE) — POST /gaps/dismiss and /gaps/reopen below only ever
// resolve/reopen an EXISTING row, they never insert one.
router.get('/gaps', (req, res, next) => {
  try {
    const { platform } = req.query;
    const gaps = listOpenGaps(platform || null);
    res.json({ gaps });
  } catch (err) {
    next(err);
  }
});

// POST /api/account-roster/gaps/dismiss — { accountName, platform, month } →
// marks the gap resolved with resolution='no_posts' (the account genuinely
// published nothing that month). Later imports cannot re-create the row
// (INSERT OR IGNORE).
router.post('/gaps/dismiss', (req, res, next) => {
  try {
    const { accountName, platform, month } = req.body;
    if (!accountName || !platform || !month) {
      return res.status(400).json({ error: 'accountName, platform och month krävs.' });
    }
    const changes = dismissGapMonth(accountName, platform, month);
    res.json({ ok: true, changes });
  } catch (err) {
    next(err);
  }
});

// POST /api/account-roster/gaps/reopen — { accountName, platform, month } →
// undoes a dismiss (only resolution='no_posts'; never touches 'imported').
router.post('/gaps/reopen', (req, res, next) => {
  try {
    const { accountName, platform, month } = req.body;
    if (!accountName || !platform || !month) {
      return res.status(400).json({ error: 'accountName, platform och month krävs.' });
    }
    const changes = reopenGapMonth(accountName, platform, month);
    res.json({ ok: true, changes });
  } catch (err) {
    next(err);
  }
});

export default router;
