const express = require('express');
const { supabaseAdmin } = require('../supabaseClient');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(auth, requireRole('administrateur'));

// GET /api/utilisateurs — liste des comptes (back office)
router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('profils').select('id, nom, role, actif, created_at').order('nom');
  if (error) return res.status(500).json({ erreur: error.message });
  res.json(data);
});

// PATCH /api/utilisateurs/:id — changer le rôle ou activer/désactiver un compte
router.patch('/:id', async (req, res) => {
  const { role, actif } = req.body;
  const champs = {};
  if (role) champs.role = role;
  if (typeof actif === 'boolean') champs.actif = actif;

  const { data, error } = await supabaseAdmin.from('profils').update(champs).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ erreur: error.message });
  res.json(data); // le changement de rôle est tracé automatiquement (trigger trg_profils_role)
});

module.exports = router;
