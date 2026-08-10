const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { dbAsync } = require('./db');
const { compileSketch, checkArduinoCliAvailable, BINARIES_DIR } = require('./compilationService');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS & Body Parsers
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'client')));

const os = require('os');
const isVercel = !!process.env.VERCEL;
const tempUploadDir = isVercel ? path.join(os.tmpdir(), 'uploads', 'temp') : path.join(__dirname, 'uploads', 'temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const upload = multer({
  dest: tempUploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.ino' || ext === '.bin' || ext === '.hex' || ext === '.cpp' || ext === '.c' || file.mimetype.includes('text')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Accepted formats: .ino, .bin, .hex'));
    }
  }
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'flasher_super_secret_jwt_key_2026';

/**
 * Authentication Middleware for Admin routes
 */
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }
}

// ==========================================
// ADMIN AUTHENTICATION ENDPOINTS
// ==========================================

/**
 * POST /api/admin/login
 * Validates admin credentials and returns JWT token
 */
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const admin = await dbAsync.get(`SELECT * FROM admins WHERE username = ?`, [username]);
    if (!admin) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ message: 'Login successful!', token, username: admin.username });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error during login.' });
  }
});

/**
 * GET /api/admin/verify
 * Validates current session token
 */
app.get('/api/admin/verify', authenticateAdmin, (req, res) => {
  return res.json({ valid: true, username: req.admin.username });
});

/**
 * POST /api/admin/change-password
 * Allows logged-in admin to update password
 */
app.post('/api/admin/change-password', authenticateAdmin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old password and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  try {
    const admin = await dbAsync.get(`SELECT * FROM admins WHERE id = ?`, [req.admin.id]);
    if (!admin) {
      return res.status(404).json({ error: 'Admin account not found.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, admin.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect old password.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await dbAsync.run(`UPDATE admins SET password_hash = ? WHERE id = ?`, [newHash, req.admin.id]);

    return res.json({ message: 'Password updated successfully!' });
  } catch (error) {
    console.error('Error updating password:', error);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

// ==========================================
// ADMIN PROJECT MANAGEMENT ENDPOINTS
// ==========================================

/**
 * POST /api/admin/upload-project
 * Handles sketch file upload, invokes arduino-cli, saves binary to disk & DB, deletes source .ino
 */
const { v4: uuidv4 } = require('uuid');

app.post('/api/admin/upload-project', authenticateAdmin, upload.single('ino_file'), async (req, res) => {
  const { title, description, board_type } = req.body;
  const file = req.file;

  if (!title || !description || !board_type) {
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Title, description, and board_type are required.' });
  }

  if (!file) {
    return res.status(400).json({ error: 'Please select a valid file (.ino, .bin, or .hex) to upload.' });
  }

  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  console.log(`📥 Upload request received: "${title}" (${file.originalname}) for board "${board_type}"`);

  try {
    let projectId, binFilePath, fileType, logs;

    if (ext === 'bin' || ext === 'hex') {
      // Direct binary upload (No arduino-cli compilation required)
      projectId = uuidv4();
      fileType = ext;
      binFilePath = `${projectId}.${fileType}`;
      const destPath = path.join(BINARIES_DIR, binFilePath);

      fs.copyFileSync(file.path, destPath);
      try { fs.unlinkSync(file.path); } catch (_) {}

      logs = `Direct pre-compiled binary upload accepted.\nFormat: .${fileType.toUpperCase()}\nSaved as: ${binFilePath}`;
    } else {
      // .ino sketch compilation via arduino-cli
      const result = await compileSketch(file.path, file.originalname, board_type);
      projectId = result.projectId;
      binFilePath = result.binFilePath;
      fileType = result.fileType;
      logs = result.logs;
    }

    // Save project metadata to SQLite database
    await dbAsync.run(
      `INSERT INTO projects (id, title, description, board_type, bin_file_path, file_type) VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, title, description, board_type, binFilePath, fileType]
    );

    console.log(`🎉 Project successfully published: ${projectId}`);

    return res.status(201).json({
      message: 'Project published successfully!',
      project: {
        id: projectId,
        title,
        description,
        board_type,
        file_type: fileType
      },
      logs
    });

  } catch (error) {
    if (file && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }
    console.error('❌ Upload/Compilation Error:', error.message || error);
    return res.status(500).json({
      error: error.message || 'Processing failed.',
      logs: error.logs || ''
    });
  }
});

/**
 * DELETE /api/admin/projects/:id
 * Removes project record from database and deletes its binary file from storage
 */
app.delete('/api/admin/projects/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const project = await dbAsync.get(`SELECT * FROM projects WHERE id = ?`, [id]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // Delete stored binary file
    const binaryPath = path.join(BINARIES_DIR, project.bin_file_path);
    if (fs.existsSync(binaryPath)) {
      try { fs.unlinkSync(binaryPath); } catch (_) {}
    }

    // Delete record from DB
    await dbAsync.run(`DELETE FROM projects WHERE id = ?`, [id]);

    return res.json({ message: 'Project deleted successfully.' });
  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({ error: 'Failed to delete project.' });
  }
});

// ==========================================
// USER ENDPOINTS
// ==========================================

/**
 * GET /api/projects
 * Fetches list of all available compiled projects for end-users
 */
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await dbAsync.all(
      `SELECT id, title, description, board_type, file_type, created_at FROM projects ORDER BY created_at DESC`
    );
    return res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

/**
 * GET /api/projects/:id/binary
 * Downloads or streams the compiled binary file (.bin or .hex) for flashing
 */
app.get('/api/projects/:id/binary', async (req, res) => {
  const { id } = req.params;

  try {
    const project = await dbAsync.get(`SELECT * FROM projects WHERE id = ?`, [id]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    const binaryPath = path.join(BINARIES_DIR, project.bin_file_path);
    if (!fs.existsSync(binaryPath)) {
      return res.status(404).json({ error: 'Compiled binary file is missing from server storage.' });
    }

    const filename = `${project.title.replace(/[^a-z0-9_-]/gi, '_')}.${project.file_type}`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(binaryPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error serving binary:', error);
    return res.status(500).json({ error: 'Failed to download binary file.' });
  }
});

/**
 * GET /api/health
 * Diagnostic route to verify API status and arduino-cli availability
 */
app.get('/api/health', async (req, res) => {
  const cliAvailable = await checkArduinoCliAvailable();
  return res.json({
    status: 'online',
    arduinoCliInstalled: cliAvailable,
    timestamp: new Date().toISOString()
  });
});

// Start Server if run directly
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Static files served from: ${path.join(__dirname, '..', 'client')}`);
  });
}

module.exports = app;
