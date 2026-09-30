const express = require('express');
const { supabaseAdmin } = require('../supabaseClient');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { envoyerWhatsapp } = require('../services/whatsapp');

const router = express.Router();
router.use(auth, requireRole('gestionnaire', 'administrateur'));

// Rapproche un produit revenu en stock avec les demandes en attente, et déclenche l'envoi.
async function rapprocherEtNotifier(produitId) {
  const { data: enAttente } = await supabaseAdmin
    .from('demandes')
    .select('id, client_telephone, client_prenom')
    .eq('produit_id', produitId)
    .eq('statut', 'en_attente');

  for (const demande of enAttente || []) {
    await supabaseAdmin.from('demandes').update({ statut: 'notifie' }).eq('id', demande.id);

    let messageId = null;
    let statutEnvoi = 'echec';
    try {
      messageId = await envoyerWhatsapp(demande.client_telephone, 'produit_disponible', [demande.client_prenom]);
      statutEnvoi = 'envoye';
    } catch (err) {
      console.error('Échec envoi WhatsApp, sera repris en SMS par la file', err.message);
    }

    await supabaseAdmin.from('notifications').insert({
      demande_id: demande.id,
      canal: 'whatsapp',
      statut: statutEnvoi,
    });
  }

  return enAttente?.length || 0;
}

// POST /api/stock/valider — Mode A : validation manuelle d'un produit
router.post('/valider', async (req, res) => {
  const { produit_id } = req.body;
  if (!produit_id) return res.status(400).json({ erreur: 'produit_id requis' });

  const { error } = await supabaseAdmin
    .from('produits')
    .update({ en_stock: true, maj_le: new Date().toISOString(), maj_par: req.profil.id })
    .eq('id', produit_id);

  if (error) return res.status(500).json({ erreur: error.message });

  const nbNotifies = await rapprocherEtNotifier(produit_id);
  res.json({ ok: true, clients_notifies: nbNotifies });
});

// POST /api/stock/import — Mode B : import d'un fichier CSV déjà parsé côté frontend
// Le frontend envoie un tableau [{ nom, dci, quantite_recue }] après lecture du CSV — le parsing
// du fichier lui-même reste côté client (ou un futur worker dédié), pas dans cette route.
router.post('/import', async (req, res) => {
  const { fichier_nom, lignes } = req.body;
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ erreur: 'Aucune ligne à traiter' });
  }

  let reconnues = 0;
  let rapprochees = 0;

  for (const ligne of lignes) {
    const { data: produit } = await supabaseAdmin
      .from('produits')
      .select('id')
      .ilike('nom', ligne.nom)
      .maybeSingle();

    if (!produit) continue; // produit non reconnu dans le référentiel — ignoré, à traiter manuellement
    reconnues += 1;

    await supabaseAdmin
      .from('produits')
      .update({ en_stock: true, maj_le: new Date().toISOString(), maj_par: req.profil.id })
      .eq('id', produit.id);

    rapprochees += await rapprocherEtNotifier(produit.id);
  }

  const { data: importEnr, error } = await supabaseAdmin
    .from('imports_stock')
    .insert({
      fichier_nom: fichier_nom || 'import.csv',
      gestionnaire_id: req.profil.id,
      lignes_reconnues: reconnues,
      demandes_rapprochees: rapprochees,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ erreur: error.message });
  res.json(importEnr);
});

module.exports = router;
