const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../supabaseClient');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { envoyerWhatsapp } = require('../services/whatsapp');

const router = express.Router();

// Vérification de signature Meta (header X-Hub-Signature-256, HMAC SHA-256 avec le token WhatsApp).
function signatureMetaValide(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const attendu = 'sha256=' + crypto
    .createHmac('sha256', process.env.WHATSAPP_TOKEN)
    .update(req.rawBody || '')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(attendu));
}

// GET — validation initiale du webhook par Meta
router.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// POST — accusés de réception et réponses du client ("Réserver" / "Passer plus tard")
router.post('/webhook/whatsapp', async (req, res) => {
  if (!signatureMetaValide(req)) return res.sendStatus(401);

  const changement = req.body?.entry?.[0]?.changes?.[0]?.value;
  const statuts = changement?.statuses || [];
  const messages = changement?.messages || [];

  for (const s of statuts) {
    await supabaseAdmin
      .from('notifications')
      .update({ statut: s.status, maj_le: new Date().toISOString() }) // 'delivered' | 'read' | 'failed'
      .eq('id', s.id);
  }

  for (const m of messages) {
    const reponse = m.button?.text?.toLowerCase();
    if (!reponse) continue;

    const { data: notif } = await supabaseAdmin
      .from('notifications')
      .select('demande_id')
      .eq('id', m.context?.id)
      .maybeSingle();
    if (!notif) continue;

    await supabaseAdmin.from('notifications').update({ reponse_client: reponse }).eq('demande_id', notif.demande_id);

    if (reponse.includes('réserver')) {
      // Simple alerte à valider par le vendeur — ne bloque jamais le produit automatiquement.
      await supabaseAdmin.from('demandes').update({ reserve_le: new Date().toISOString() }).eq('id', notif.demande_id);
    }
  }

  res.sendStatus(200);
});

// POST — callback de statut MTarget (jeton partagé, pas de signature HMAC standard chez ce fournisseur)
router.post('/webhook/mtarget', async (req, res) => {
  if (req.headers['x-mtarget-token'] !== process.env.MTARGET_CALLBACK_TOKEN) return res.sendStatus(401);

  const { message_id, statut } = req.body; // statut: 'delivered' | 'failed'
  await supabaseAdmin
    .from('notifications')
    .update({ statut: statut === 'delivered' ? 'delivre' : 'echec', maj_le: new Date().toISOString() })
    .eq('id', message_id);

  res.sendStatus(200);
});

// POST /api/notifications/test — envoi de test par l'administrateur, sans demande réelle
router.post('/test', auth, requireRole('administrateur'), async (req, res) => {
  const { telephone, prenom } = req.body;
  if (!telephone) return res.status(400).json({ erreur: 'Numéro requis' });

  try {
    const id = await envoyerWhatsapp(telephone, 'produit_disponible', [prenom || 'Test']);
    res.json({ ok: true, message_id: id });
  } catch (err) {
    res.status(502).json({ erreur: err.message });
  }
});

module.exports = router;
