# ⚡ Microcontroller Code Flasher Platform

A full-stack, web-based platform for compiling Arduino sketches (`.ino`) into protected binaries (`.bin` / `.hex`) and flashing them directly to microcontrollers (**ESP32**, **ESP8266**, and **Arduino Uno**) from the browser using the **Web Serial API**.

---

## 🔒 Source Code Protection Architecture
1. **Admin Sketch Upload**: Admins upload raw `.ino` files alongside title, description, and target board FQBN (`esp32:esp32:esp32`, `arduino:avr:uno`, `esp8266:esp8266:generic`).
2. **Background Compilation**: The Express backend executes `arduino-cli` in a isolated child process to compile the sketch into a `.bin` or `.hex` binary file.
3. **Immediate Source Deletion**: The temporary raw `.ino` sketch file is **permanently deleted** immediately after successful compilation. Only compiled binaries are saved to disk and recorded in the SQLite database.
4. **Browser Serial Flashing**: End-users select projects from the catalog and flash the binary directly to their connected microcontroller over Web Serial API using `esptool-js` (ESP32/ESP8266) or `STK500v1` protocol (Arduino Uno). End-users never see or access the underlying `.ino` source code.

---

## 🛠️ Prerequisites & Setup Guide

### 1. Install Node.js
Ensure Node.js (v18+ recommended) is installed:
```bash
node -v
npm -v
```

---

### 2. Install `arduino-cli` on the Server Host

#### 🪟 Windows:
Download the latest `arduino-cli` release from [Arduino CLI Releases](https://github.com/arduino/arduino-cli/releases), or install via `winget`:
```powershell
winget install Arduino.cli
```
*Make sure `arduino-cli` is added to your system `PATH` environment variable.*

#### 🐧 Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
sudo mv bin/arduino-cli /usr/local/bin/
```

#### 🍎 macOS:
```bash
brew install arduino-cli
```

---

### 3. Configure `arduino-cli` Cores & Board Indexes

Run the following commands on your server machine to initialize `arduino-cli` and download support for **Arduino AVR**, **ESP32**, and **ESP8266**:

```bash
# 1. Initialize configuration file
arduino-cli config init

# 2. Add board manager URLs for ESP32 and ESP8266
arduino-cli config set board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json http://arduino.esp8266.com/stable/package_esp8266com_index.json

# 3. Update index cache
arduino-cli core update-index

# 4. Install board cores
arduino-cli core install arduino:avr
arduino-cli core install esp32:esp32
arduino-cli core install esp8266:esp8266
```

Verify installed cores with:
```bash
arduino-cli core list
```
You should see `arduino:avr`, `esp32:esp32`, and `esp8266:esp8266` listed.

---

## 🚀 Launching the Platform Server

```bash
# 1. Install Node.js dependencies
npm install

# 2. Start the Express production server
npm start

# Development mode with auto-reload:
npm run dev
```

The application will launch at **`http://localhost:3000`**.

---

## 💻 Web Serial Browser Compatibility

End-users must use a modern Chromium-based browser that supports the Web Serial API:
- ✅ **Google Chrome** (v89+)
- ✅ **Microsoft Edge** (v89+)
- ✅ **Opera** / **Brave**
- ❌ *Firefox and Safari do not currently support Web Serial API.*

---

## 📁 File Structure

```
code Flasher/
├── package.json                   # Project dependencies and npm scripts
├── README.md                      # Setup and core installation guide
├── server/
│   ├── server.js                  # Express API routes, file uploads, binary download
│   ├── compilationService.js      # arduino-cli process execution & sketch isolation
│   ├── db.js                      # SQLite database initialization & async query wrappers
│   └── uploads/                   # Binary storage directory (.ino source deleted)
└── client/
    ├── index.html                 # Single-page application UI layout
    ├── css/
    │   └── styles.css             # Glassmorphism dark mode theme & terminal styling
    └── js/
        ├── app.js                 # UI logic, catalog rendering, Web Serial port handler
        ├── esp-flasher.js         # esptool-js wrapper for ESP32 & ESP8266 flashing
        └── stk500-flasher.js      # Custom STK500v1 serial flasher & Intel HEX parser for Arduino Uno
```

---

## 🧪 Testing the Application Workflow

1. Open `http://localhost:3000` in Google Chrome or Microsoft Edge.
2. Click **⚙️ Admin Portal** tab.
3. Upload an example `.ino` file (e.g. `Blink.ino`), enter a title, choose target board (e.g. `Arduino Uno` or `ESP32`), and click **Compile Sketch & Publish Binary**.
4. Observe the `arduino-cli` stdout/stderr terminal output.
5. Click **📖 User Catalog** tab to view your newly published binary project.
6. Connect your microcontroller via USB, click **🔌 Connect & Flash**, select your serial COM port, and click **⚡ Flash Compiled Binary to Microcontroller**.
