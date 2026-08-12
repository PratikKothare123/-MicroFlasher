const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const postgres = require('postgres');
const bcrypt = require('bcryptjs');

console.log('DATABASE_URL loaded:', !!process.env.DATABASE_URL);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

// Supabase Transaction Pooler
const sql = postgres(connectionString, {
  prepare: false,
  ssl: 'require',
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {}
});

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, $3...
function convertPlaceholders(query) {
  let index = 0;

  return query.replace(/\?/g, () => {
    index++;
    return `$${index}`;
  });
}

// Initialize database tables
async function initializeDatabase() {
  try {
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

    await sql`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Ensure all columns exist in projects
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS id TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS title TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS board_type TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS bin_file_path TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'bin'`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS binary_data TEXT`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;

    // Ensure all columns exist in admins
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS id TEXT`;
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS username TEXT`;
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_hash TEXT`;
    await sql`ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS admins_username_idx ON admins (username)`;

    // Create default admin if it doesn't exist
    const existingAdmin = await sql`
      SELECT *
      FROM admins
      WHERE username = 'admin'
      LIMIT 1
    `;

    if (existingAdmin.length === 0) {
      const defaultPasswordHash = bcrypt.hashSync('admin123', 10);

      await sql`
        INSERT INTO admins (
          id,
          username,
          password_hash
        )
        VALUES (
          'admin_default',
          'admin',
          ${defaultPasswordHash}
        )
      `;

      console.log('✅ Default admin created');
    }

    console.log('✅ Supabase PostgreSQL database initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// Convert SQLite SQL syntax to PostgreSQL where necessary
function prepareQuery(query) {
  let prepared = query.trim();

  // SQLite CURRENT_TIMESTAMP works in PostgreSQL,
  // but DATETIME is not a PostgreSQL type.
  prepared = prepared.replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ');

  // SQLite uses ? parameters.
  prepared = convertPlaceholders(prepared);

  return prepared;
}

// Universal database wrapper
const dbAsync = {
  async all(query, params = []) {
    const preparedQuery = prepareQuery(query);

    try {
      const rows = await sql.unsafe(preparedQuery, params);
      return rows;
    } catch (error) {
      console.error('❌ DB all() error:', error);
      console.error('Query:', query);
      throw error;
    }
  },

  async get(query, params = []) {
    const preparedQuery = prepareQuery(query);

    try {
      const rows = await sql.unsafe(preparedQuery, params);

      return rows.length > 0 ? rows[0] : undefined;
    } catch (error) {
      console.error('❌ DB get() error:', error);
      console.error('Query:', query);
      throw error;
    }
  },

  async run(query, params = []) {
    const preparedQuery = prepareQuery(query);

    try {
      const result = await sql.unsafe(preparedQuery, params);

      return {
        lastID: null,
        changes: result.count || 0
      };
    } catch (error) {
      console.error('❌ DB run() error:', error);
      console.error('Query:', query);
      throw error;
    }
  }
};

// Initialize database when this module loads
initializeDatabase().catch((error) => {
  console.error('❌ Failed to initialize database:', error);
});

module.exports = {
  db: sql,
  dbAsync
};