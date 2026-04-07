const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'piracy-detector.db');

let db = null;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      status TEXT DEFAULT 'pending',
      total_dramas INTEGER DEFAULT 0,
      completed_dramas INTEGER DEFAULT 0,
      operator_name TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      drama_id TEXT NOT NULL,
      input_name TEXT,
      name TEXT,
      chinese_name TEXT,
      cp_name TEXT,
      is_self_made BOOLEAN,
      content_type TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS search_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_db_id INTEGER REFERENCES dramas(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT,
      snippet TEXT,
      page_number INTEGER,
      is_pirated INTEGER DEFAULT NULL,
      domain TEXT
    );
  `);
}

// ===== Task Operations =====

function createTask(dramaList) {
  const db = getDb();
  const insertTask = db.prepare(
    'INSERT INTO tasks (total_dramas) VALUES (?)'
  );
  const insertDrama = db.prepare(
    'INSERT INTO dramas (task_id, drama_id, input_name) VALUES (?, ?, ?)'
  );

  const result = db.transaction(() => {
    const taskResult = insertTask.run(dramaList.length);
    const taskId = taskResult.lastInsertRowid;

    for (const drama of dramaList) {
      insertDrama.run(taskId, drama.id, drama.inputName);
    }

    return taskId;
  })();

  return result;
}

function getAllTasks() {
  const db = getDb();
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM dramas d WHERE d.task_id = t.id AND d.status = 'completed') as completed_dramas,
      (SELECT COUNT(*) FROM dramas d WHERE d.task_id = t.id AND d.status = 'skipped') as skipped_dramas
    FROM tasks t ORDER BY t.created_at DESC
  `).all();
}

function getTask(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

function updateTask(taskId, data) {
  const db = getDb();
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  db.prepare(`UPDATE tasks SET ${fields} WHERE id = ?`).run(...values, taskId);
}

// ===== Drama Operations =====

function getDramasByTask(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM dramas WHERE task_id = ? ORDER BY id').all(taskId);
}

function getDrama(dramaDbId) {
  const db = getDb();
  return db.prepare('SELECT * FROM dramas WHERE id = ?').get(dramaDbId);
}

function updateDrama(dramaDbId, data) {
  const db = getDb();
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  db.prepare(`UPDATE dramas SET ${fields} WHERE id = ?`).run(...values, dramaDbId);
}

// ===== Search Result Operations =====

function addSearchResults(dramaDbId, results) {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO search_results (drama_db_id, url, title, snippet, page_number, domain) VALUES (?, ?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    for (const r of results) {
      const domain = extractDomain(r.url);
      insert.run(dramaDbId, r.url, r.title, r.snippet, r.pageNumber, domain);
    }
  })();
}

function getSearchResults(dramaDbId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM search_results WHERE drama_db_id = ? ORDER BY page_number, id'
  ).all(dramaDbId);
}

function markPirated(resultId, isPirated) {
  const db = getDb();
  db.prepare('UPDATE search_results SET is_pirated = ? WHERE id = ?').run(
    isPirated ? 1 : 0,
    resultId
  );
}

function getPiratedResults(taskId) {
  const db = getDb();
  return db.prepare(`
    SELECT sr.*, d.drama_id, d.name, d.chinese_name, d.cp_name, d.content_type
    FROM search_results sr
    JOIN dramas d ON sr.drama_db_id = d.id
    WHERE d.task_id = ? AND sr.is_pirated = 1
    ORDER BY d.id, sr.id
  `).all(taskId);
}

// ===== Utilities =====

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function parseDramaInput(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results = [];
  const idRegex = /\((\d{10,})\)\s*$/;

  for (const line of lines) {
    const match = line.match(idRegex);
    if (match) {
      const id = match[1];
      const inputName = line.replace(idRegex, '').trim();
      results.push({ id, inputName });
    }
  }
  return results;
}

module.exports = {
  getDb,
  createTask,
  getAllTasks,
  getTask,
  updateTask,
  getDramasByTask,
  getDrama,
  updateDrama,
  addSearchResults,
  getSearchResults,
  markPirated,
  getPiratedResults,
  parseDramaInput,
};
