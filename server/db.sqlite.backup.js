const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

const isVercel = !!process.env.VERCEL;
const dataDir = isVercel ? os.tmpdir() : path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
}

const dbPath = path.join(dataDir, 'flasher.sqlite');

let db = null;
let useFallbackDb = false;

const defaultPasswordHash = bcrypt.hashSync('admin123', 10);

// In-Memory / Global Fallback Store for Serverless Vercel
const fallbackStore = {
  projects: [],
  admins: [
    {
      id: 'admin_default',
      username: 'admin',
      password_hash: defaultPasswordHash,
      created_at: new Date().toISOString()
    }
  ]
};

try {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.warn('⚠️ SQLite connection error, switching to memory fallback:', err.message);
      useFallbackDb = true;
    } else {
      console.log('⚡ SQLite Database connected at:', dbPath);
    }
  });

  if (db) {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          board_type TEXT NOT NULL,
          bin_file_path TEXT NOT NULL,
          file_type TEXT NOT NULL DEFAULT 'bin',
          binary_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, () => {
        db.run(`ALTER TABLE projects ADD COLUMN binary_data TEXT`, () => {});
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS admins (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, async (err) => {
        if (!err) {
          db.get(`SELECT * FROM admins WHERE username = 'admin'`, [], async (err, row) => {
            if (!err && !row) {
              db.run(`INSERT INTO admins (id, username, password_hash) VALUES ('admin_default', 'admin', ?)`, [defaultPasswordHash]);
            }
          });
        }
      });
    });
  }
} catch (e) {
  console.warn('⚠️ Native sqlite3 module not available in this environment. Using in-memory store:', e.message);
  useFallbackDb = true;
}

// Universal database async wrapper (works with SQLite & Serverless Memory Fallback)
const dbAsync = {
  async all(query, params = []) {
    if (!useFallbackDb && db) {
      return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    }

    // Fallback handler
    if (query.includes('projects')) {
      return fallbackStore.projects.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        board_type: p.board_type,
        bin_file_path: p.bin_file_path,
        file_type: p.file_type,
        created_at: p.created_at
      })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    if (query.includes('admins')) {
      return [...fallbackStore.admins];
    }
    return [];
  },

  async get(query, params = []) {
    if (!useFallbackDb && db) {
      return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    }

    // Fallback handler
    if (query.includes('FROM projects WHERE id =')) {
      return fallbackStore.projects.find(p => p.id === params[0]) || null;
    }
    if (query.includes('FROM admins WHERE username =')) {
      return fallbackStore.admins.find(a => a.username === params[0]) || null;
    }
    if (query.includes('FROM admins WHERE id =')) {
      return fallbackStore.admins.find(a => a.id === params[0]) || null;
    }
    if (query.includes('COUNT(*)')) {
      return { count: fallbackStore.projects.length };
    }
    return null;
  },

  async run(query, params = []) {
    if (!useFallbackDb && db) {
      return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    }

    // Fallback handler
    if (query.startsWith('INSERT INTO projects')) {
      fallbackStore.projects.push({
        id: params[0],
        title: params[1],
        description: params[2],
        board_type: params[3],
        bin_file_path: params[4],
        file_type: params[5],
        binary_data: params[6] || null,
        created_at: new Date().toISOString()
      });
    } else if (query.startsWith('DELETE FROM projects')) {
      fallbackStore.projects = fallbackStore.projects.filter(p => p.id !== params[0]);
    } else if (query.startsWith('UPDATE projects SET')) {
      const project = fallbackStore.projects.find(p => p.id === params[3]);
      if (project) {
        project.title = params[0];
        project.description = params[1];
        project.board_type = params[2];
      }
    } else if (query.startsWith('UPDATE admins SET password_hash')) {
      const admin = fallbackStore.admins.find(a => a.id === params[1]);
      if (admin) admin.password_hash = params[0];
    }
    return { changes: 1 };
  }
};

module.exports = { db, dbAsync };
