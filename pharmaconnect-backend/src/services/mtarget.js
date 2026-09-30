// Envoi SMS de secours via MTarget. Cf. annexe commerciale — facturé à la consommation réelle.
async function envoyerSms(telephone, texte) {
  const res = await fetch('https://api.mtarget.fr/sms/v3/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MTARGET_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MTARGET_SENDER_ID,
      to: telephone,
      text: texte,
    }),
  });

  if (!res.ok) throw new Error(`Échec envoi SMS (${res.status})`);
  const data = await res.json();
  return data.id || null;
}

module.exports = { envoyerSms };
