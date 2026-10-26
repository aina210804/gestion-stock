const nodemailer = require('nodemailer');
const { run, get } = require('../db/database');

function setting(cle, defaut = '') {
  const row = get('SELECT valeur FROM settings WHERE cle = ?', [cle]);
  return row ? row.valeur : defaut;
}

const PRESETS = {
  GMAIL: { host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true },
  GOOGLE_WORKSPACE: { host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true },
  OUTLOOK: { host: 'smtp-mail.outlook.com', port: 587, secure: false, requireTLS: true },
  OFFICE365: { host: 'smtp.office365.com', port: 587, secure: false, requireTLS: true },
  YAHOO: { host: 'smtp.mail.yahoo.com', port: 587, secure: false, requireTLS: true },
  ORANGE: { host: 'ssl0.ovh.net', port: 587, secure: false, requireTLS: true },
  OVH: { host: 'ssl0.ovh.net', port: 587, secure: false, requireTLS: true },
};

function config() {
  const provider = (process.env.SMTP_PROVIDER || '').toUpperCase();
  const preset = PRESETS[provider] || null;
  const port = parseInt(process.env.SMTP_PORT, 10) || (preset ? preset.port : 587);
  const host = process.env.SMTP_HOST || (preset ? preset.host : '');
  const user = process.env.SMTP_USER || '';
  return {
    provider: provider || null,
    host,
    port,
    secure: process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ''
      ? String(process.env.SMTP_SECURE) === '1'
      : port === 465 || (preset ? preset.secure : false),
    requireTLS: preset ? preset.requireTLS : port === 587,
    user,
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || user || null,
    fromName: process.env.MAIL_FROM_NAME || setting('SOCIETE', 'Gestion de stock'),
    actif: !!host,
  };
}

let transporter = null;
let transporterKey = '';

function getTransporter() {
  const c = config();
  if (!c.actif) return null;
  const key = JSON.stringify([c.host, c.port, c.user, c.secure]);
  if (transporter && transporterKey === key) return transporter;
  transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    requireTLS: c.requireTLS,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });
  transporterKey = key;
  return transporter;
}

function erreursConnexion(err) {
  const msg = String((err && err.message) || err);
  if (/Invalid login|Authentication failed|535|Username and Password not accepted|Aidez-nous à protéger/i.test(msg)) {
    return "Échec d'authentification SMTP : pour Gmail, utilisez un MOT DE PASSE D'APPLICATION (compte Google → Sécurité → Vérification en 2 étapes → Mots de passe d'application), pas le mot de passe normal.";
  }
  if (/ETIMEDOUT|ECONNREFUSED|getaddrinfo|connection/i.test(msg)) {
    return `Impossible de joindre le serveur ${config().host}:${config().port} (${msg}).`;
  }
  if (/Envelop|Mail from|553|550|not accepted from your IP/i.test(msg)) {
    return `Adresse d'expéditeur refusée par le serveur (${msg}). Vérifiez MAIL_FROM (doit être une adresse Gmail valide).`;
  }
  return msg;
}

async function sendMail({ to, subject, text, type = 'SYSTEME', userId = null }) {
  if (!to) return null;
  const c = config();
  let statut = 'SIMULE';
  let erreur = null;

  if (!c.actif) {
    console.log(`[MAIL:simulation] -> ${to} | ${subject}`);
  } else if (!c.user || !c.pass) {
    statut = 'ERREUR';
    erreur = 'SMTP configuré mais SMTP_USER / SMTP_PASS manquants dans le fichier .env';
    console.log(`[MAIL:erreur] ${erreur}`);
  } else if (!c.from) {
    statut = 'ERREUR';
    erreur = 'MAIL_FROM manquant dans le fichier .env';
  } else {
    try {
      await getTransporter().sendMail({
        from: `"${c.fromName}" <${c.from}>`,
        to,
        subject,
        text,
        headers: { 'X-Mailer': 'Gestion de stock consommables' },
      });
      statut = 'ENVOYE';
      console.log(`[MAIL:envoye] -> ${to} | ${subject}`);
    } catch (err) {
      statut = 'ERREUR';
      erreur = erreursConnexion(err);
      console.error('[MAIL:echec]', erreur);
    }
  }

  const res = run(
    'INSERT INTO notifications (destinataire, sujet, corps, type, statut, erreur, user_id) VALUES (?,?,?,?,?,?,?)',
    [to, subject, text, type, statut, erreur, userId]
  );
  return { id: res.lastInsertRowid, statut, erreur };
}

// Teste la connexion SMTP (utilisé par le bouton "Tester la configuration")
async function verifier() {
  const c = config();
  if (!c.actif) {
    return { actif: false, ok: false, message: 'Aucun serveur SMTP configuré : mode simulation actif' };
  }
  if (!c.user || !c.pass) {
    return { actif: true, ok: false, message: 'SMTP_USER et SMTP_PASS doivent être renseignés dans .env', config: c };
  }
  if (!c.from) {
    return { actif: true, ok: false, message: 'MAIL_FROM doit être renseigné dans .env', config: c };
  }
  try {
    await getTransporter().verify();
    return { actif: true, ok: true, message: `Connexion SMTP réussie (${c.host}:${c.port})`, config: c };
  } catch (err) {
    return { actif: true, ok: false, message: erreursConnexion(err), config: c };
  }
}

function sendStockAlert(article, alert) {
  const dest = setting('EMAIL_ALERTES', process.env.MAIL_FROM || process.env.SMTP_USER || '');
  if (!dest) return Promise.resolve(null);
  const societe = setting('SOCIETE', 'Gestion de stock');
  const sujet = `[${societe}] ${alert.type === 'RUPTURE' ? 'RUPTURE DE STOCK' : 'Stock bas'} - ${article.nom} (${article.reference})`;
  const corps = [
    `Bonjour,`,
    ``,
    alert.type === 'RUPTURE'
      ? `Une rupture de stock est constatée pour l'article suivant :`
      : `L'article suivant est passé sous son seuil d'alerte :`,
    ``,
    `  Article      : ${article.nom} (${article.reference})`,
    `  Stock actuel : ${article.stock} ${article.unite}`,
    `  Seuil alerte : ${article.seuil_alerte} ${article.unite}`,
    `  Emplacement  : ${article.emplacement || '-'}`,
    `  Fournisseur  : article rattaché au plan d'approvisionnement`,
    ``,
    `Merci de déclencher un réapprovisionnement depuis le module « Approvisionnements ».`,
    ``,
    `--`,
    `Message automatique généré par ${societe} - Gestion de stock des consommables`,
  ].join('\n');
  return sendMail({ to: dest, subject: sujet, text: corps, type: 'ALERTE_STOCK' });
}

function notifyOrder(order, action, user) {
  const dest = setting('EMAIL_ALERTES');
  if (!dest) return Promise.resolve(null);
  const societe = setting('SOCIETE', 'Gestion de stock');
  const corps = [
    `Bonjour,`,
    ``,
    `Le bon de commande ${order.numero} a été ${action}.`,
    `Fournisseur : ${order.fournisseur_nom || '-'}`,
    `Montant     : ${Number(order.total || 0).toLocaleString('fr-FR')} Ar`,
    `Par         : ${user ? `${user.prenom} ${user.nom} (${user.matricule})` : '-'}`,
    ``,
    `--`,
    `Message automatique généré par ${societe} - Gestion de stock des consommables`,
  ].join('\n');
  return sendMail({
    to: dest,
    subject: `[${societe}] Bon de commande ${order.numero} : ${action}`,
    text: corps,
    type: 'BON_COMMANDE',
    userId: user ? user.id : null,
  });
}

function masquer(mdp) {
  if (!mdp) return '';
  return mdp.length > 4 ? `${mdp.slice(0, 2)}${'*'.repeat(Math.min(mdp.length - 2, 12))}` : '****';
}

function modeInfo() {
  const c = config();
  return {
    smtp_configure: c.actif,
    provider: c.provider,
    smtp_host: c.host || null,
    smtp_port: c.port || null,
    smtp_user: c.user ? `${c.user}` : null,
    smtp_pass_renseigne: !!c.pass,
    from: c.from,
    from_name: c.fromName,
    destinataire_alertes: setting('EMAIL_ALERTES', ''),
    message: c.actif
      ? c.user && c.pass
        ? `Envoi réel via ${c.provider || 'SMTP'} (${c.host}:${c.port})`
        : 'Serveur SMTP défini mais identifiants manquants (SMTP_USER / SMTP_PASS)'
      : 'Mode simulation : les e-mails sont journalisés dans cette page (renseignez SMTP_PROVIDER/SMTP_USER/SMTP_PASS dans .env)',
    password_masque: masquer(c.pass),
  };
}

module.exports = { sendMail, sendStockAlert, notifyOrder, setting, verifier, modeInfo, config };
