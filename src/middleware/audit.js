const { run, get } = require('../db/database');
const { fmtDateTime } = require('../utils/helpers');

function audit(ctx, action, entite = null, entiteId = null, details = null) {
  const user = (ctx && (ctx.user || ctx.session?.user)) || null;
  const ip =
    (ctx && (ctx.ip || ctx.socket?.remoteAddress)) ||
    (ctx && ctx.req && ctx.req.ip) ||
    null;
  try {
    run(
      `INSERT INTO audit_logs (user_id, matricule, action, entite, entite_id, details, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        user ? user.id : null,
        user ? user.matricule : null,
        action,
        entite,
        entiteId,
        details ? JSON.stringify(details) : null,
        ip ? String(ip).replace('::ffff:', '') : null,
        fmtDateTime(),
      ]
    );
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

module.exports = { audit };
