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
