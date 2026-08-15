# MicroFlasher — Supabase PostgreSQL & Serverless Migration Guide

This document explains the complete step-by-step technical architecture, database setup, environment configuration, code modifications, and deployment procedure for the **MicroFlasher** application.

---

## 🎯 1. The Core Problem Explained

### Why SQLite Failed on Vercel
In the original implementation, MicroFlasher used **SQLite (`sqlite3`)** storing data in a local file (`data/database.sqlite`) and saved binary files (`.bin`/`.hex`) directly to disk in `server/uploads/binaries/`.

* **Vercel Serverless Architecture:** Vercel functions are stateless and ephemeral. Every request may run on a fresh container with a read-only filesystem (except `/tmp`).
* **The Result:** Any project uploaded or saved to SQLite was erased when the serverless container restarted or went cold, resulting in **100% data loss**.

### The Solution: Supabase PostgreSQL + Base64 Binary Persistence
1. Replaced SQLite with **Supabase PostgreSQL** via the `postgres` (porsager) Node.js client driver.
2. Connected to Supabase's **Transaction Pooler (PgBouncer)** for high concurrency in serverless environments.
3. Added a `binary_data` column storing binary files as **Base64 strings** inside PostgreSQL. This ensures compiled binaries persist permanently without relying on local disk storage.

---

## 🛠️ 2. Complete Step-by-Step Implementation

### Step 1: Environment & Secrets Setup

Create a `.env` file in `server/.env` (and/or root `.env`):

```env
DATABASE_URL="postgresql://postgres.[YOUR_PROJECT_REF]:[YOUR_PASSWORD]@aws-0-[YOUR_REGION].pooler.supabase.com:6543/postgres"
JWT_SECRET="flasher_super_secret_jwt_key_2026"
```

> **IMPORTANT:** Ensure `.env` is added to `.gitignore` so database credentials are never committed to Git.

#### Code Fix: Explicit `.env` Path Loading
In Node.js, `require('dotenv').config()` only searches `process.cwd()`. To ensure environment variables load correctly whether starting from root or inside `server/`, we configure:

```javascript
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
```

---

### Step 2: Supabase Database Setup & Auto-Migration (`server/db.js`)

#### Connecting to Supabase PgBouncer Pooler
We configure `postgres` driver options optimized for Supabase transaction poolers (port `6543`):

```javascript
const postgres = require('postgres');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;

const sql = postgres(connectionString, {
  prepare: false,      // PgBouncer pooler mode does not support prepared statements
  ssl: 'require',      // Mandatory SSL for Supabase connections
  max: 10,             // Max connection pool limit
  idle_timeout: 20,    // Close idle connections after 20 seconds
  connect_timeout: 10, // Timeout after 10 seconds if un-connectable
  onnotice: () => {}   // Suppress verbose PostgreSQL notices
});
```

#### Non-Destructive Auto-Schema Initialization
When the backend starts, `initializeDatabase()` automatically verifies and creates missing tables or missing columns without dropping existing data:

```javascript
async function initializeDatabase() {
  try {
    // 1. Create projects table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        board_type TEXT NOT NULL,
        bin_file_path TEXT NOT NULL,
        file_type TEXT NOT NULL DEFAULT 'bin',
        binary_data TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // 2. Create admins table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // 3. Ensure all columns exist (in case tables existed previously without all columns)
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS id TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS title TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS board_type TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS bin_file_path TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'bin'`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS binary_data TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;

    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS id TEXT`;
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS username TEXT`;
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_hash TEXT`;
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS admins_username_idx ON admins (username)`;

    // 4. Create default admin if not existing
    const existingAdmin = await sql`SELECT * FROM admins WHERE username = 'admin' LIMIT 1`;
    if (existingAdmin.length === 0) {
      const defaultPasswordHash = bcrypt.hashSync('admin123', 10);
      await sql`
        INSERT INTO admins (id, username, password_hash)
        VALUES ('admin_default', 'admin', ${defaultPasswordHash})
      `;
      console.log('✅ Default admin created (username: admin, pass: admin123)');
    }

    console.log('✅ Supabase PostgreSQL database initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}
```

---

### Step 3: Backward-Compatible SQLite Query Wrapper (`dbAsync`)

The existing API routes relied on `dbAsync.all()`, `dbAsync.get()`, and `dbAsync.run()` with `?` parameter syntax. We preserved this abstraction layer:

#### SQLite Parameter Conversion (`?` to `$1`, `$2`, `$3`)
```javascript
function convertPlaceholders(query) {
  let index = 0;
  return query.replace(/\?/g, () => {
    index++;
    return `$${index}`;
  });
}

function prepareQuery(query) {
  let prepared = query.trim();
  prepared = prepared.replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ'); // SQLite DATETIME -> Postgres TIMESTAMPTZ
  prepared = convertPlaceholders(prepared);                     // ? -> $1, $2
  return prepared;
}
```

#### `dbAsync` Implementation
```javascript
const dbAsync = {
  async all(query, params = []) {
    const preparedQuery = prepareQuery(query);
    const rows = await sql.unsafe(preparedQuery, params);
    return rows;
  },

  async get(query, params = []) {
    const preparedQuery = prepareQuery(query);
    const rows = await sql.unsafe(preparedQuery, params);
    return rows.length > 0 ? rows[0] : undefined;
  },

  async run(query, params = []) {
    const preparedQuery = prepareQuery(query);
    const result = await sql.unsafe(preparedQuery, params);
    return {
      lastID: null,
      changes: result.count || 0
    };
  }
};
```

---

### Step 4: Binary Base64 Storage & Serverless Retrieval (`server/server.js`)

#### 1. Upload Route (`POST /api/admin/upload-project`)
When a pre-compiled `.bin`/`.hex` or compiled `.ino` is published, we read the binary file from disk and convert it to Base64 before inserting it into PostgreSQL:

```javascript
// Read binary file into base64 string
let binaryData = null;
const finalBinPath = path.join(BINARIES_DIR, binFilePath);
if (fs.existsSync(finalBinPath)) {
  try {
    binaryData = fs.readFileSync(finalBinPath).toString('base64');
  } catch (err) {
    console.warn('⚠️ Could not read binary for DB storage:', err.message);
  }
}

// Save project metadata + Base64 binary to PostgreSQL
await dbAsync.run(
  `INSERT INTO projects (id, title, description, board_type, bin_file_path, file_type, binary_data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [projectId, title, description, board_type, binFilePath, fileType, binaryData]
);
```

#### 2. Download Route (`GET /api/projects/:id/binary`)
When a user or WebSerial flasher downloads the binary file:
1. First, check if the file exists on local disk storage.
2. If absent (e.g. running on Vercel serverless execution), fall back to decoding `project.binary_data` from Base64 directly:

```javascript
app.get('/api/projects/:id/binary', async (req, res) => {
  const { id } = req.params;
  const project = await dbAsync.get(`SELECT * FROM projects WHERE id = ?`, [id]);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const filename = `${project.title.replace(/[^a-z0-9_-]/gi, '_')}.${project.file_type}`;
  const binaryPath = path.join(BINARIES_DIR, project.bin_file_path);

  // 1. Try serving from local disk storage
  if (fs.existsSync(binaryPath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return fs.createReadStream(binaryPath).pipe(res);
  }

  // 2. Serverless fallback: Serve from Base64 binary in Supabase PostgreSQL
  if (project.binary_data) {
    const buffer = Buffer.from(project.binary_data, 'base64');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  }

  return res.status(404).json({ error: 'Compiled binary file is missing.' });
});
```

---

## 🚀 3. How to Run Locally

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Start Backend Server:**
   ```bash
   npm start
   ```

3. **Access App & Test Admin:**
   * Open browser: `http://localhost:3000`
   * Admin Login: `admin` / `admin123`
   * Upload `.bin` or `.hex` pre-compiled firmware.

---

## ☁️ 4. Deploying to Vercel

1. Push your repository to GitHub.
2. Import project into Vercel.
3. Add Environment Variables under **Project Settings > Environment Variables**:
   * `DATABASE_URL` = `postgresql://postgres.[REF]:[PASS]@aws-0-[REGION].pooler.supabase.com:6543/postgres`
   * `JWT_SECRET` = `flasher_super_secret_jwt_key_2026`
4. Deploy! Vercel uses `vercel.json` and `api/index.js` to route requests to the backend serverlessly.

---

## 📊 Summary of Modified Files

| File | Purpose |
|---|---|
| **[server/db.js](file:///d:/Desktop/-MicroFlasher/server/db.js)** | Supabase `postgres` driver client, `dotenv` path loader, auto-migration schema init, and `dbAsync` wrapper |
| **[server/server.js](file:///d:/Desktop/-MicroFlasher/server/server.js)** | Cleaned imports, base64 binary storage in `upload-project`, and serverless fallback streaming in `binary` route |
| **[package.json](file:///d:/Desktop/-MicroFlasher/package.json)** | Declares dependencies (`postgres`, `dotenv`, `bcryptjs`, `express`, `jsonwebtoken`, `multer`) |
| **[.gitignore](file:///d:/Desktop/-MicroFlasher/.gitignore)** | Ignores `.env` secrets file |
