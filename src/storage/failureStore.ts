import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

// Lightweight local store for failed message forwards. Uses Bun's built-in SQLite.
const dbPath = path.join(process.cwd(), "data", "failures.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath, { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS failed_messages (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    sender_id TEXT,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    message TEXT,
    error TEXT,
    source_id TEXT,
    contact_id TEXT,
    inbox_id TEXT
  )
`);

export interface FailedMessageRecord {
  senderId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  message?: string;
  error?: string;
  sourceId?: string;
  contactId?: string | number;
  inboxId?: string | number;
}

export async function recordFailedMessage(entry: FailedMessageRecord): Promise<void> {
  try {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT INTO failed_messages (
        id, created_at, sender_id, username, first_name, last_name, phone, message, error, source_id, contact_id, inbox_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Helpful index for FIFO retrieval
    db.run(`CREATE INDEX IF NOT EXISTS idx_failed_messages_created_at ON failed_messages(created_at)`);
    stmt.run(
      id,
      createdAt,
      entry.senderId || null,
      entry.username || null,
      entry.firstName || null,
      entry.lastName || null,
      entry.phone || null,
      entry.message || null,
      entry.error || null,
      entry.sourceId || null,
      entry.contactId != null ? String(entry.contactId) : null,
      entry.inboxId != null ? String(entry.inboxId) : null
    );
  } catch (err) {
    console.warn("[LocalFailureStore] Failed to record failed message", err);
  }
}

// Fetch next failed message in FIFO order (oldest first)
export function fetchNextFailedMessage(): FailedMessageRecord & { id: string } | undefined {
  const stmt = db.prepare(
    `SELECT id, created_at, sender_id, username, first_name, last_name, phone, message, error, source_id, contact_id, inbox_id
     FROM failed_messages
     ORDER BY created_at ASC
     LIMIT 1`
  );
  const row = stmt.get();
  if (!row) return undefined;
  return {
    id: row.id,
    senderId: row.sender_id || undefined,
    username: row.username || undefined,
    firstName: row.first_name || undefined,
    lastName: row.last_name || undefined,
    phone: row.phone || undefined,
    message: row.message || undefined,
    error: row.error || undefined,
    sourceId: row.source_id || undefined,
    contactId: row.contact_id || undefined,
    inboxId: row.inbox_id || undefined,
  };
}

// Delete a failed message by id (after successful replay)
export function deleteFailedMessage(id: string): void {
  const stmt = db.prepare(`DELETE FROM failed_messages WHERE id = ?`);
  stmt.run(id);
}
