// À utiliser après `auth`. Exemple : router.post('/', auth, requireRole('gestionnaire', 'administrateur'), handler)
function requireRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.profil) return res.status(401).json({ erreur: 'Authentification requise' });
    if (!rolesAutorises.includes(req.profil.role)) {
      return res.status(403).json({ erreur: 'Rôle insuffisant pour cette action' });
    }
    next();
  };
}

module.exports = { requireRole };
