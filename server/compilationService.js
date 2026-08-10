const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const os = require('os');

const isVercel = !!process.env.VERCEL;
const UPLOADS_DIR = isVercel ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, 'uploads');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
const BINARIES_DIR = path.join(UPLOADS_DIR, 'binaries');

// Ensure necessary directories exist
[UPLOADS_DIR, TEMP_DIR, BINARIES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Helper to resolve arduino-cli executable path
 */
function getArduinoCliCmd() {
  if (process.env.ARDUINO_CLI_PATH && fs.existsSync(process.env.ARDUINO_CLI_PATH)) {
    return process.env.ARDUINO_CLI_PATH;
  }
  const localBin = path.join(__dirname, 'bin', 'arduino-cli.exe');
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return 'arduino-cli';
}

/**
 * Checks if arduino-cli is available on the system PATH or local bin.
 * @returns {Promise<boolean>}
 */
async function checkArduinoCliAvailable() {
  const cliCmd = getArduinoCliCmd();
  return new Promise((resolve) => {
    exec(`"${cliCmd}" version`, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Compiles a raw .ino file using arduino-cli and outputs a protected binary (.bin or .hex).
 * Deletes the raw .ino file after compilation.
 * 
 * @param {string} tempInoPath - Path to the temporarily uploaded .ino file
 * @param {string} originalFilename - Original uploaded filename (e.g. Blink.ino)
 * @param {string} boardType - FQBN target (e.g. esp32:esp32:esp32, arduino:avr:uno, esp8266:esp8266:generic)
 * @returns {Promise<{ projectId: string, binFilePath: string, fileType: string, logs: string }>}
 */
async function compileSketch(tempInoPath, originalFilename, boardType) {
  const isCliAvailable = await checkArduinoCliAvailable();
  if (!isCliAvailable) {
    // Clean up temporary upload file if compilation cannot run
    if (fs.existsSync(tempInoPath)) {
      try { fs.unlinkSync(tempInoPath); } catch (_) {}
    }
    throw new Error(
      `'arduino-cli' is not installed or not available in PATH on the server.\n` +
      `Please install arduino-cli and required cores (arduino:avr, esp32:esp32, esp8266:esp8266).\n` +
      `Refer to README.md for server setup instructions.`
    );
  }

  const projectId = uuidv4();
  // Create a unique temporary sketch directory named identical to the sketch file
  const sketchName = `sketch_${projectId.replace(/-/g, '')}`;
  const sketchDir = path.join(TEMP_DIR, sketchName);
  fs.mkdirSync(sketchDir, { recursive: true });

  const sketchInoPath = path.join(sketchDir, `${sketchName}.ino`);
  
  // Move uploaded .ino file into sketchDir as sketchName.ino
  fs.copyFileSync(tempInoPath, sketchInoPath);
  try { fs.unlinkSync(tempInoPath); } catch (_) {}

  // Output build directory for compiled binaries
  const buildOutDir = path.join(TEMP_DIR, `build_${sketchName}`);
  fs.mkdirSync(buildOutDir, { recursive: true });

  const cliCmd = getArduinoCliCmd();
  const command = `"${cliCmd}" compile --fqbn "${boardType}" --output-dir "${buildOutDir}" "${sketchDir}"`;

  console.log(`🚀 Executing: ${command}`);

  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const logs = (stdout || '') + '\n' + (stderr || '');

      // Clean up temporary sketch directory (protect source code)
      try {
        fs.rmSync(sketchDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Warning: Failed to clean up sketch directory:', e.message);
      }

      if (error) {
        // Clean up build output dir on error
        try { fs.rmSync(buildOutDir, { recursive: true, force: true }); } catch (_) {}
        
        console.error('❌ Compilation failed:', stderr);
        return reject({
          message: `Compilation failed for FQBN '${boardType}'. Check output logs for syntax errors or missing libraries.`,
          logs: logs.trim()
        });
      }

      console.log('✅ Compilation stdout:', stdout);

      // Locate generated binary file (.bin or .hex) in buildOutDir
      try {
        const files = fs.readdirSync(buildOutDir);
        let foundBin = null;
        let fileType = 'bin';

        // Preference order for binaries:
        // 1. .ino.merged.bin (ESP32 merged factory binary if available)
        // 2. .bin
        // 3. .hex (Arduino AVR)
        const mergedBin = files.find(f => f.endsWith('.merged.bin'));
        const standardBin = files.find(f => f.endsWith('.bin'));
        const hexFile = files.find(f => f.endsWith('.hex'));

        if (mergedBin) {
          foundBin = mergedBin;
          fileType = 'bin';
        } else if (standardBin) {
          foundBin = standardBin;
          fileType = 'bin';
        } else if (hexFile) {
          foundBin = hexFile;
          fileType = 'hex';
        }

        if (!foundBin) {
          fs.rmSync(buildOutDir, { recursive: true, force: true });
          return reject({
            message: 'Compilation reported success, but no .bin or .hex output file was found.',
            logs: logs.trim()
          });
        }

        const compiledSrcPath = path.join(buildOutDir, foundBin);
        const destBinFilename = `${projectId}.${fileType}`;
        const destBinPath = path.join(BINARIES_DIR, destBinFilename);

        fs.copyFileSync(compiledSrcPath, destBinPath);

        // Clean up build output dir
        fs.rmSync(buildOutDir, { recursive: true, force: true });

        console.log(`📦 Compiled binary saved to: ${destBinPath}`);

        resolve({
          projectId,
          binFilePath: destBinFilename, // relative filename stored in db
          fileType,
          logs: logs.trim()
        });

      } catch (err) {
        try { fs.rmSync(buildOutDir, { recursive: true, force: true }); } catch (_) {}
        reject({
          message: `Failed to process compiled binary output: ${err.message}`,
          logs: logs.trim()
        });
      }
    });
  });
}

module.exports = {
  compileSketch,
  checkArduinoCliAvailable,
  BINARIES_DIR
};
