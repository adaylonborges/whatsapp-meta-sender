const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'whatsapp_sender.sqlite');
const db = new DatabaseSync(dbPath);

// Inicialização das Tabelas
db.exec(`
  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    template TEXT,
    status TEXT NOT NULL,
    wamid TEXT,
    error TEXT,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_dispatches_wamid ON dispatches(wamid);
  CREATE INDEX IF NOT EXISTS idx_dispatches_created_at ON dispatches(created_at);

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    recipient_id TEXT,
    wamid TEXT,
    status TEXT,
    errors TEXT,
    raw_payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_wamid ON webhook_events(wamid);

  CREATE TABLE IF NOT EXISTS media_vault (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Métodos de Disparos
function saveDispatch({ id, type, recipient, template = null, status, wamid = null, error = null, payload = null }) {
  const stmt = db.prepare(`
    INSERT INTO dispatches (id, type, recipient, template, status, wamid, error, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);
  stmt.run(
    String(id),
    String(type),
    String(recipient),
    template ? String(template) : null,
    String(status),
    wamid ? String(wamid) : null,
    error ? String(error) : null,
    payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null
  );
}

function updateDispatchStatus(wamid, newStatus, error = null) {
  if (!wamid) return;
  const stmt = db.prepare(`
    UPDATE dispatches 
    SET status = ?, error = COALESCE(?, error)
    WHERE wamid = ?
  `);
  stmt.run(String(newStatus), error ? String(error) : null, String(wamid));
}

function getRecentDispatches(limit = 100) {
  const stmt = db.prepare(`
    SELECT id, type, recipient, template, status, wamid, error, payload, created_at
    FROM dispatches
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

// Métodos de Métricas e Funil
function getMetrics() {
  const totalStmt = db.prepare(`SELECT COUNT(*) as count FROM dispatches`);
  const total = totalStmt.get().count;

  const statusStmt = db.prepare(`
    SELECT status, COUNT(*) as count 
    FROM dispatches 
    GROUP BY status
  `);
  const statusRows = statusStmt.all();
  
  const counts = {
    total,
    accepted: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0
  };

  statusRows.forEach(r => {
    if (counts.hasOwnProperty(r.status)) {
      counts[r.status] = r.count;
    }
  });

  // Taxas
  const deliveredTotal = counts.delivered + counts.read;
  const successBase = counts.accepted + counts.sent + deliveredTotal;
  const deliveryRate = successBase > 0 ? ((deliveredTotal / successBase) * 100).toFixed(1) : 0;
  const readRate = deliveredTotal > 0 ? ((counts.read / deliveredTotal) * 100).toFixed(1) : 0;

  return {
    ...counts,
    deliveryRate,
    readRate
  };
}

// Métodos de Webhook
function saveWebhookEvent({ id, event_type, recipient_id = null, wamid = null, status = null, errors = null, raw_payload = null }) {
  const stmt = db.prepare(`
    INSERT INTO webhook_events (id, event_type, recipient_id, wamid, status, errors, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);
  stmt.run(
    String(id),
    String(event_type),
    recipient_id ? String(recipient_id) : null,
    wamid ? String(wamid) : null,
    status ? String(status) : null,
    errors ? (typeof errors === 'string' ? errors : JSON.stringify(errors)) : null,
    raw_payload ? (typeof raw_payload === 'string' ? raw_payload : JSON.stringify(raw_payload)) : null
  );

  if (wamid && status) {
    updateDispatchStatus(wamid, status, errors ? (typeof errors === 'string' ? errors : JSON.stringify(errors)) : null);
  }
}

// Métodos de Media Vault
function saveMedia({ mediaId, filename, mimeType, fileSize = 0 }) {
  const id = 'media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const stmt = db.prepare(`
    INSERT INTO media_vault (id, media_id, filename, mime_type, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(media_id) DO UPDATE SET
      filename = excluded.filename,
      file_size = excluded.file_size
  `);
  stmt.run(id, String(mediaId), String(filename), String(mimeType), Number(fileSize));
  return { id, mediaId, filename, mimeType, fileSize };
}

function getMediaList(limit = 50) {
  const stmt = db.prepare(`
    SELECT id, media_id, filename, mime_type, file_size, created_at
    FROM media_vault
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

module.exports = {
  db,
  saveDispatch,
  updateDispatchStatus,
  getRecentDispatches,
  getMetrics,
  saveWebhookEvent,
  saveMedia,
  getMediaList
};
