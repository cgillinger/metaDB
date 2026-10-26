import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { PLATFORMS, METRICS, MAX_ACCOUNTS, isMonth, isYear, listAccounts, buildSeries, buildYearlySeries } from '../services/crowdtangle/series.js';

const router = Router();

// GET /accounts?platform= — accounts that have historic CrowdTangle data
router.get('/accounts', (req, res) => {
  const platform = req.query.platform;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Ogiltig plattform.' });
  res.json({ accounts: listAccounts(getDb(), platform) });
});

// GET /series?platform=&metric=&accounts=k1,k2&from=YYYY-MM&to=YYYY-MM
router.get('/series', (req, res) => {
  const { platform, metric, from, to } = req.query;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Ogiltig plattform.' });
  if (!Object.hasOwn(METRICS, metric)) return res.status(400).json({ error: 'Ogiltigt mått.' });
  if ((from && !isMonth(from)) || (to && !isMonth(to))) {
    return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
  }
  const accounts = String(req.query.accounts || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!accounts.length) return res.status(400).json({ error: 'Välj minst ett konto.' });
  if (accounts.length > MAX_ACCOUNTS) return res.status(400).json({ error: `Högst ${MAX_ACCOUNTS} konton åt gången.` });
  res.json(buildSeries(getDb(), { platform, metric, accounts, from, to }));
});

// GET /yearly?platform=&metric=&accounts=k1,k2&from=YYYY&to=YYYY
router.get('/yearly', (req, res) => {
  const { platform, metric, from, to } = req.query;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Ogiltig plattform.' });
  if (!Object.hasOwn(METRICS, metric)) return res.status(400).json({ error: 'Ogiltigt mått.' });
  if ((from && !isYear(from)) || (to && !isYear(to))) {
    return res.status(400).json({ error: 'Ogiltigt årsformat. Förväntat: YYYY.' });
  }
  const accounts = String(req.query.accounts || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!accounts.length) return res.status(400).json({ error: 'Välj minst ett konto.' });
  if (accounts.length > MAX_ACCOUNTS) return res.status(400).json({ error: `Högst ${MAX_ACCOUNTS} konton åt gången.` });
  res.json(buildYearlySeries(getDb(), { platform, metric, accounts, fromYear: from, toYear: to }));
});

export default router;
