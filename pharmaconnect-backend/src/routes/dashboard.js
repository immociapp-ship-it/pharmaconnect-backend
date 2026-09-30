const express = require('express');
const { supabaseAdmin } = require('../supabaseClient');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');

const router = express.Router();
router.use(auth, requireRole('gestionnaire', 'administrateur'));

// GET /api/dashboard/stats?periode=jour|semaine
router.get('/stats', async (req, res) => {
  const periode = req.query.periode === 'semaine' ? 7 : 1;
  const depuis = new Date(Date.now() - periode * 24 * 60 * 60 * 1000).toISOString();

  const { data: demandes } = await supabaseAdmin.from('demandes').select('statut, produits(nom)').gte('created_at', depuis);
  const { data: notifs } = await supabaseAdmin.from('notifications').select('statut').gte('envoye_le', depuis);

  const compte = (liste, cle, val) => (liste || []).filter((x) => x[cle] === val).length;

  const parProduit = {};
  for (const d of demandes || []) {
    const nom = d.produits?.nom || 'Inconnu';
    parProduit[nom] = (parProduit[nom] || 0) + 1;
  }
  const topProduits = Object.entries(parProduit).sort((a, b) => b[1] - a[1]).slice(0, 5);

  res.json({
    en_attente: compte(demandes, 'statut', 'en_attente'),
    revenus_en_stock: compte(demandes, 'statut', 'disponible') + compte(demandes, 'statut', 'notifie'),
    clients_notifies: compte(demandes, 'statut', 'notifie') + compte(demandes, 'statut', 'retire'),
    retirees: compte(demandes, 'statut', 'retire'),
    // CA estimé récupéré : calculé uniquement sur les demandes "retire", jamais une estimation automatique.
    // Le montant réel par produit n'étant pas dans ce schéma V1.2, ce total reste à brancher sur un prix unitaire
    // si la pharmacie souhaite l'activer (cf. cahier des charges §14).
    demandes_retirees_total: compte(demandes, 'statut', 'retire'),
    top_produits: topProduits,
    notifications: {
      envoyees: (notifs || []).length,
      delivrees: compte(notifs, 'statut', 'delivre'),
      echecs: compte(notifs, 'statut', 'echec'),
    },
  });
});

module.exports = router;
