const express = require('express');
const { supabaseAdmin } = require('../supabaseClient');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(auth, requireRole('administrateur'));

// GET /api/audit — journal des actions sensibles (changements de statut, de rôle, imports)
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('journal_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ erreur: error.message });
  res.json(data);
});

module.exports = router;
