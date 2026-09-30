const express = require('express');
const { supabaseAdmin } = require('../supabaseClient');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(auth);

// POST /api/demandes — le vendeur enregistre une demande client (consentement obligatoire)
router.post('/', requireRole('vendeur', 'gestionnaire', 'administrateur'), async (req, res) => {
  const { produit_id, client_prenom, client_telephone, quantite, consentement } = req.body;

  if (!produit_id || !client_prenom || !client_telephone || !consentement) {
    return res.status(400).json({ erreur: 'Produit, prénom, numéro et consentement sont obligatoires.' });
  }

  const { data, error } = await supabaseAdmin
    .from('demandes')
    .insert({
      produit_id,
      client_prenom,
      client_telephone,
      quantite: quantite || 1,
      consentement: true,
      consentement_le: new Date().toISOString(),
      vendeur_id: req.profil.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ erreur: error.message });
  res.status(201).json(data);
});

// GET /api/demandes — le vendeur voit les siennes, gestionnaire+ voit tout
router.get('/', requireRole('vendeur', 'gestionnaire', 'administrateur'), async (req, res) => {
  let query = supabaseAdmin.from('demandes').select('*, produits(nom)').order('created_at', { ascending: false });
  if (req.profil.role === 'vendeur') query = query.eq('vendeur_id', req.profil.id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ erreur: error.message });
  res.json(data);
});

// PATCH /api/demandes/:id/statut — le gestionnaire ferme/annule une demande (ex. retrait au comptoir)
const TRANSITIONS_AUTORISEES = {
  en_attente: ['annule'],
  disponible: ['notifie', 'annule'],
  notifie: ['retire', 'annule', 'expire'],
};

router.patch('/:id/statut', requireRole('gestionnaire', 'administrateur'), async (req, res) => {
  const { statut } = req.body;
  const { data: demande, error: getErr } = await supabaseAdmin
    .from('demandes')
    .select('statut')
    .eq('id', req.params.id)
    .single();

  if (getErr || !demande) return res.status(404).json({ erreur: 'Demande introuvable' });

  const autorises = TRANSITIONS_AUTORISEES[demande.statut] || [];
  if (!autorises.includes(statut)) {
    return res.status(400).json({ erreur: `Transition ${demande.statut} → ${statut} non autorisée` });
  }

  const champs = { statut };
  if (statut === 'retire') champs.retire_le = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('demandes').update(champs).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ erreur: error.message });
  res.json(data);
});

module.exports = router;
