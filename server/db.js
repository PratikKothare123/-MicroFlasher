const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const os = require('os');

const isVercel = !!process.env.VERCEL;
const dataDir = isVercel ? os.tmpdir() : path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'flasher.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Failed to connect to SQLite database:', err.message);
  } else {
    console.log('⚡ SQLite Database connected at:', dbPath);
  }
});

const bcrypt = require('bcryptjs');

// Initialize Database Schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      board_type TEXT NOT NULL,
      bin_file_path TEXT NOT NULL,
      file_type TEXT NOT NULL DEFAULT 'bin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating projects table:', err.message);
    } else {
      console.log('✅ Projects table verified/initialized.');
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, async (err) => {
    if (err) {
      console.error('❌ Error creating admins table:', err.message);
    } else {
      console.log('✅ Admins table verified/initialized.');
      // Seed default admin if no admins exist
      db.get(`SELECT COUNT(*) as count FROM admins`, [], async (err, row) => {
        if (!err && row && row.count === 0) {
          const defaultPasswordHash = await bcrypt.hash('admin123', 10);
          db.run(`INSERT INTO admins (id, username, password_hash) VALUES ('admin_default', 'admin', ?)`, [defaultPasswordHash], (err) => {
            if (!err) console.log('🔑 Default admin created: username="admin", password="admin123"');
          });
        }
      });
    }
  });
});

// Promisified database helpers
const dbAsync = {
  all(query, params = []) {
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  get(query, params = []) {
    return new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  run(query, params = []) {
    return new Promise((resolve, reject) => {
      db.run(query, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

module.exports = { db, dbAsync };
