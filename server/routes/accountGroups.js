/**
 * Account Groups API
 * CRUD endpoints for managing named account groups.
 */
import { Router } from 'express';
import {
  getAccountGroups,
  getAccountGroup,
  createAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
  deleteAllAccountGroups,
} from '../services/accountGroupService.js';

const router = Router();

// GET /api/account-groups?source=ga_listens
router.get('/', (req, res) => {
  const source = req.query.source || null;
  const groups = getAccountGroups(source);
  res.json({ groups });
});

// GET /api/account-groups/:id
router.get('/:id', (req, res) => {
  const group = getAccountGroup(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Gruppen hittades inte.' });
  res.json(group);
});

// POST /api/account-groups  { name, source, members: string[] }
router.post('/', (req, res) => {
  try {
    const { name, source, members } = req.body;
    const group = createAccountGroup(name, source, members);
    res.status(201).json(group);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/account-groups/:id  { name?, members?: string[] }
router.put('/:id', (req, res) => {
  try {
    const group = updateAccountGroup(Number(req.params.id), req.body);
    if (!group) return res.status(404).json({ error: 'Gruppen hittades inte.' });
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/account-groups/all — delete ALL groups (must come before /:id)
router.delete('/all', (req, res) => {
  const deleted = deleteAllAccountGroups();
  res.json({ deleted });
});

// DELETE /api/account-groups/:id
router.delete('/:id', (req, res) => {
  const deleted = deleteAccountGroup(Number(req.params.id));
  if (deleted === 0) return res.status(404).json({ error: 'Gruppen hittades inte.' });
  res.json({ deleted });
});

export default router;
