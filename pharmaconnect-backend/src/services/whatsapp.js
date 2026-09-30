// Envoi WhatsApp via Meta Cloud API. Le message doit utiliser un modèle (template) déjà
// approuvé par Meta — impossible d'envoyer du texte libre à un client qui n'a pas répondu depuis 24h.
async function envoyerWhatsapp(telephone, templateName, variables) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: telephone,
      type: 'template',
      template: {
        name: templateName, // ex. 'produit_disponible'
        language: { code: 'fr' },
        components: [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }],
      },
    }),
  });

  if (!res.ok) throw new Error(`Échec envoi WhatsApp (${res.status})`);
  const data = await res.json();
  return data.messages?.[0]?.id || null; // id du message, à recroiser avec le webhook de statut
}

module.exports = { envoyerWhatsapp };
