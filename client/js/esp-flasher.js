/**
 * ESP32 / ESP8266 Web Serial Flasher using local esptool-js module
 */

class ESPFlasher {
  constructor(port, logger, progressCallback) {
    this.port = port;
    this.log = logger || console.log;
    this.progress = progressCallback || (() => {});
    this.espLoader = null;
  }

  /**
   * Dynamically loads ESPLoader and Transport from local bundle
   */
  async loadEsptoolModule() {
    if (window.esptooljs && window.esptooljs.ESPLoader) {
      return window.esptooljs;
    }
    if (window.ESPLoader && window.Transport) {
      return { ESPLoader: window.ESPLoader, Transport: window.Transport };
    }

    try {
      const mod = await import('../lib/esptool-bundle.js');
      return mod;
    } catch (err) {
      this.log('⚠️ Failed to load local esptool module: ' + err.message);
      throw new Error(`esptool-js library could not be loaded (${err.message}). Ensure client/lib/esptool-bundle.js is accessible.`);
    }
  }

  /**
   * Flash raw binary ArrayBuffer onto ESP32 / ESP8266 device
   * 
   * @param {ArrayBuffer} binBuffer - Raw binary file data
   * @param {string} boardType - FQBN board identifier (e.g. esp32:esp32:esp32, esp8266:esp8266:generic)
   * @param {number} baudRate - Serial baud rate (default 115200)
   * @param {number|null} customOffset - Manual flash offset if provided
   */
  async flash(binBuffer, boardType = 'esp32', baudRate = 115200, customOffset = null) {
    this.log('🚀 Preparing ESP Web Serial Flasher...');
    this.progress(5, 'Loading esptool module...');

    const { ESPLoader: ESPLoaderClass, Transport: TransportClass } = await this.loadEsptoolModule();

    if (!ESPLoaderClass || !TransportClass) {
      throw new Error('Failed to resolve ESPLoader or Transport class from esptool module.');
    }

    const transport = new TransportClass(this.port);

    const terminalAdapter = {
      clean: () => {},
      writeLine: (data) => this.log(data),
      write: (data) => this.log(data)
    };

    try {
      this.progress(10, 'Connecting to ESP chip (Auto-detecting baud)...');
      this.log('⚡ Connecting to ESP microcontroller...');

      this.espLoader = new ESPLoaderClass({
        transport: transport,
        baudrate: baudRate,
        terminal: terminalAdapter
      });

      const chipName = await this.espLoader.main();
      this.log(`✅ ESP Board Connected! Chip Type: ${chipName}`);
      this.progress(25, `Chip identified: ${chipName}. Erasing/Preparing flash...`);

      const uint8Arr = new Uint8Array(binBuffer);
      let binString = '';
      for (let i = 0; i < uint8Arr.length; i++) {
        binString += String.fromCharCode(uint8Arr[i]);
      }

      // Automatically determine correct ESP memory flash offset address
      // ESP32 app binary -> 0x10000
      // ESP32 merged factory image (> 1 MB) -> 0x0
      // ESP8266 -> 0x0
      let offset = 0x0;

      if (customOffset !== null && customOffset !== undefined) {
        offset = customOffset;
      } else if (boardType.includes('esp32')) {
        if (binBuffer.byteLength > 1024 * 1024) {
          offset = 0x0; // Merged factory image (includes bootloader + app)
          this.log('💡 Detected Merged Factory Image (>1MB) -> Flashing to address 0x0');
        } else {
          offset = 0x10000; // Standard ESP32 application binary
          this.log('💡 Detected Standard ESP32 Application Binary -> Flashing to address 0x10000');
        }
      } else {
        offset = 0x0; // ESP8266 default
      }

      const fileArray = [
        {
          data: binString,
          address: offset
        }
      ];

      this.log(`📦 Flashing binary payload (${(binBuffer.byteLength / 1024).toFixed(1)} KB) to target offset address 0x${offset.toString(16)}...`);
      this.progress(30, 'Writing flash binary blocks...');

      await this.espLoader.writeFlash({
        fileArray: fileArray,
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          const pct = Math.floor(30 + (written / total) * 65);
          this.progress(pct, `Flashing ESP binary: ${written}/${total} bytes (${pct}%)`);
        }
      });

      this.progress(98, 'Resetting ESP chip into application mode...');
      this.log('🔄 Hard resetting ESP chip to execute new firmware...');
      
      try {
        await this.espLoader.hardReset();
      } catch (e) {
        this.log('⚠️ Hard reset note: ' + e.message);
      }

      this.progress(100, 'ESP Microcontroller Flashed Successfully!');
      this.log('🎉 Flashing complete! Microcontroller is now running your project.');

    } catch (err) {
      this.log(`❌ ESP Flashing Error: ${err.message}`);
      throw err;
    } finally {
      try {
        if (transport) await transport.disconnect();
      } catch (_) {}
    }
  }
}

window.ESPFlasher = ESPFlasher;
