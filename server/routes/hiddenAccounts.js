import express from 'express';
import { hide, unhide, listHidden } from '../services/hiddenAccounts.js';

const router = express.Router();

// GET /api/hidden-accounts
router.get('/', (req, res, next) => {
  try {
    const accounts = listHidden();
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/hidden-accounts
router.post('/', (req, res, next) => {
  try {
    const { accountName, platform } = req.body;
    if (!accountName || !platform) {
      return res.status(400).json({ error: 'accountName och platform krävs.' });
    }
    hide(accountName, platform);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hidden-accounts
router.delete('/', (req, res, next) => {
  try {
    const { accountName, platform } = req.body;
    if (!accountName || !platform) {
      return res.status(400).json({ error: 'accountName och platform krävs.' });
    }
    unhide(accountName, platform);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
