require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { demarrerFileDeNotification } = require('./services/notificationQueue');

const app = express();

// Filet de sécurité : une erreur réseau imprévue (Supabase, WhatsApp, MTarget injoignable)
// ne doit jamais faire planter tout le process — seulement échouer la requête en cours.
process.on('unhandledRejection', (err) => {
  console.error('Rejet de promesse non géré :', err);
});

// Les webhooks WhatsApp ont besoin du corps brut pour vérifier la signature Meta (HMAC).
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(cors());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/demandes', require('./routes/demandes'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/utilisateurs', require('./routes/utilisateurs'));
app.use('/api/audit', require('./routes/audit'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`PharmaConnect backend démarré sur le port ${port}`);
  demarrerFileDeNotification(); // tourne en continu — possible car hébergé sur Railway, pas en serverless
});
