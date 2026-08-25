import { Router } from 'express';
import {
  listRoster,
  retireAccount,
  reactivateAccount,
  listOpenGaps,
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
// No POST /gaps: account_gaps is written exclusively by the import transaction.
router.get('/gaps', (req, res, next) => {
  try {
    const { platform } = req.query;
    const gaps = listOpenGaps(platform || null);
    res.json({ gaps });
  } catch (err) {
    next(err);
  }
});

export default router;
