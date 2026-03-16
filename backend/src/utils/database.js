import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/dilab.db');

let db;

export function initDatabase() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      node_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      size_bytes INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dataset_tags (
      dataset_id INTEGER NOT NULL REFERENCES datasets(id),
      tag_id INTEGER NOT NULL REFERENCES tags(id),
      PRIMARY KEY (dataset_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER REFERENCES datasets(id),
      source_node TEXT NOT NULL,
      target_node TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      progress_pct INTEGER DEFAULT 0,
      started_by TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      value REAL,
      threshold REAL,
      acknowledged INTEGER DEFAULT 0,
      acknowledged_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default tags if empty
  const tagCount = db.prepare('SELECT COUNT(*) as c FROM tags').get();
  if (tagCount.c === 0) {
    const defaultTags = [
      ['Multimodal', '#6366f1'],
      ['Federated Learning', '#10b981'],
      ['PROMPT project', '#f59e0b'],
      ['Video - FFmpeg Processed', '#ef4444'],
      ['Privacy-Preserving ML', '#8b5cf6'],
      ['NLP', '#3b82f6'],
      ['Computer Vision', '#06b6d4'],
      ['Speech', '#84cc16'],
      ['Medical Imaging', '#f97316'],
      ['Benchmark', '#ec4899'],
      ['Synthetic', '#a78bfa'],
      ['Raw', '#94a3b8']
    ];
    const insertTag = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)');
    for (const [name, color] of defaultTags) insertTag.run(name, color);
  }

  console.log('[DB] Database initialized at', DB_PATH);
  return db;
}

export function getDatabase() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}
