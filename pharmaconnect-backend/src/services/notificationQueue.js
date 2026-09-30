// File de reprise WhatsApp -> SMS. Ce module tourne en continu car le backend est hébergé
// sur Railway (service persistant), pas en fonctions serverless — voir cahier des charges §12.
const { supabaseAdmin } = require('../supabaseClient');
const { envoyerSms } = require('./mtarget');

const DELAI_BASCULE_MS = 15 * 60 * 1000; // 15 minutes avant de basculer sur SMS
const MAX_TENTATIVES = 3;

async function verifierNotificationsEnAttente() {
  const seuil = new Date(Date.now() - DELAI_BASCULE_MS).toISOString();

  const { data: enAttente, error } = await supabaseAdmin
    .from('notifications')
    .select('id, demande_id, tentative, demandes(client_telephone, client_prenom)')
    .eq('canal', 'whatsapp')
    .in('statut', ['en_cours', 'envoye'])
    .lt('envoye_le', seuil);

  if (error) {
    console.error('Erreur lecture file de notifications', error);
    return;
  }

  for (const notif of enAttente || []) {
    if (notif.tentative >= MAX_TENTATIVES) {
      await supabaseAdmin.from('notifications').update({ statut: 'echec' }).eq('id', notif.id);
      continue;
    }

    try {
      await envoyerSms(
        notif.demandes.client_telephone,
        `Bonjour ${notif.demandes.client_prenom}, votre produit demandé est de nouveau disponible à la Pharmacie du Terminus 40.`
      );
      await supabaseAdmin
        .from('notifications')
        .update({ canal: 'sms', statut: 'envoye', tentative: notif.tentative + 1, maj_le: new Date().toISOString() })
        .eq('id', notif.id);
    } catch (err) {
      console.error('Échec bascule SMS pour la notification', notif.id, err.message);
    }
  }
}

function demarrerFileDeNotification() {
  // Toutes les minutes — suffisant vu le délai de bascule de 15 minutes.
  setInterval(verifierNotificationsEnAttente, 60 * 1000);
  console.log('File de reprise des notifications démarrée.');
}

module.exports = { demarrerFileDeNotification };
