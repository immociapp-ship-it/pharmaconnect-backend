# PharmaConnect — Backend

API REST (Express) pour PharmaConnect — Pharmacie du Terminus 40. Hébergée sur Railway,
connectée à Supabase (base de données, authentification).

## Démarrage

```bash
npm install
cp .env.example .env   # puis renseigner les vraies clés
npm run dev
```

## Appliquer le schéma sur Supabase

```bash
supabase link --project-ref <id-du-projet>
supabase db push        # applique supabase/migrations/20260929000000_init.sql
```

## Structure

- `src/middleware/auth.js` — vérifie le token Supabase et charge le profil (rôle, actif).
- `src/middleware/requireRole.js` — restreint une route à une liste de rôles.
- `src/routes/` — une route par domaine fonctionnel (demandes, stock, notifications, dashboard, utilisateurs, audit).
- `src/services/notificationQueue.js` — tâche de fond (toutes les minutes) qui bascule vers le SMS
  les notifications WhatsApp non délivrées après 15 minutes. Possible en continu grâce à l'hébergement
  Railway (service persistant, pas de fonctions serverless).
- `supabase/migrations/` — schéma SQL versionné (tables, contraintes, RLS, triggers d'audit).

## Sécurité

- Le backend utilise la clé `service_role` Supabase (contourne RLS) : **jamais exposée au frontend**.
- Chaque route vérifie le rôle métier (`vendeur` / `gestionnaire` / `administrateur`), pas seulement l'authentification.
- Les webhooks WhatsApp/MTarget sont protégés par vérification de signature/jeton — voir `routes/notifications.js`.
- Les changements de statut de demande et de rôle utilisateur sont tracés automatiquement dans `journal_audit`.
