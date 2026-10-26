const { ApiError } = require('../utils/errors');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  return res.status(401).json({ error: 'Authentification requise' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    req.user = req.session.user;
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Accès refusé : droit insuffisant pour cette opération' });
    }
    return next();
  };
}

function hasRole(user, roles) {
  return !!user && roles.includes(user.role);
}

const PERMISSIONS = {
  admin: ['*'],
  gestionnaire: [
    'dashboard:view', 'articles:view', 'articles:write', 'movements:write', 'inventory:write',
    'suppliers:write', 'orders:create', 'orders:receive', 'alerts:manage', 'forecast:view',
    'planning:manage', 'reports:view', 'notifications:view', 'audit:view',
  ],
  responsable: [
    'dashboard:view', 'articles:view', 'movements:view', 'inventory:view', 'suppliers:view',
    'orders:validate', 'orders:receive', 'alerts:manage', 'forecast:view', 'planning:view',
    'reports:view', 'notifications:view', 'audit:view',
  ],
};

function permissionsFor(role) {
  return PERMISSIONS[role] || [];
}

module.exports = { requireAuth, requireRole, hasRole, permissionsFor, PERMISSIONS };
