import { Router } from 'express';
import {
  getBesokVsLankklick,
  getBesokVsLankklickGroup,
  getComparisonAccounts,
} from '../services/comparisonService.js';

const router = Router();

router.get('/accounts', (req, res) => {
  try {
    const result = getComparisonAccounts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/besok-lankklick', (req, res) => {
  const { account, months: monthsParam } = req.query;

  if (!account) {
    return res.status(400).json({ error: 'account krävs.' });
  }

  const months = monthsParam
    ? monthsParam.split(',').map(m => m.trim()).filter(Boolean)
    : null;

  try {
    const data = getBesokVsLankklick(account, months);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/besok-lankklick-group', (req, res) => {
  const { members, months: monthsParam } = req.query;

  if (!members) {
    return res.status(400).json({ error: 'members krävs (kommaseparerade GA-namn).' });
  }

  const memberGaNames = members.split(',').map(m => m.trim()).filter(Boolean);
  const months = monthsParam
    ? monthsParam.split(',').map(m => m.trim()).filter(Boolean)
    : null;

  try {
    const result = getBesokVsLankklickGroup(memberGaNames, months);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
