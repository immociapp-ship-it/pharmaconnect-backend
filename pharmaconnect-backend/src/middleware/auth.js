// Vérifie le token Supabase envoyé par le frontend (Authorization: Bearer <token>),
// puis charge le profil métier (rôle, actif) correspondant et l'attache à req.profil.
const { supabaseAdmin } = require('../supabaseClient');

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erreur: 'Authentification requise' });

  try {
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ erreur: 'Token invalide' });

    const { data: profil, error: profilErr } = await supabaseAdmin
      .from('profils')
      .select('id, nom, role, actif')
      .eq('user_id', userData.user.id)
      .single();

    if (profilErr || !profil || !profil.actif) {
      return res.status(403).json({ erreur: 'Compte inconnu ou désactivé' });
    }

    req.profil = profil; // { id, nom, role, actif }
    next();
  } catch (err) {
    // Erreur réseau/Supabase injoignable : ne jamais laisser une promesse rejetée non gérée
    // faire planter le process — on répond proprement à la place.
    console.error('Erreur middleware auth :', err.message);
    res.status(503).json({ erreur: 'Service d\'authentification indisponible' });
  }
}

module.exports = { auth };
