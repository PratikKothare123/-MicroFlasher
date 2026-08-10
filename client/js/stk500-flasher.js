/**
 * STK500v1 Serial Protocol Flasher & Intel HEX Parser
 * Used for flashing Arduino Uno (ATmega328P) over Web Serial API
 */

class STK500Flasher {
  constructor(port, logger, progressCallback) {
    this.port = port;
    this.log = logger || console.log;
    this.progress = progressCallback || (() => {});
    this.reader = null;
    this.writer = null;

    // STK500 Constants
    this.STK_OK = 0x10;
    this.STK_INSYNC = 0x14;
    this.STK_GET_SYNC = 0x30;
    this.STK_ENTER_PROGMODE = 0x50;
    this.STK_LEAVE_PROGMODE = 0x51;
    this.STK_LOAD_ADDRESS = 0x55;
    this.STK_PROG_PAGE = 0x64;
    this.CRC_EOP = 0x20;
    this.PAGE_SIZE = 128; // ATmega328P Flash Page Size
  }

  /**
   * Parse Intel HEX format string into a binary memory array buffer
   */
  static parseHex(hexString) {
    const lines = hexString.split(/\r?\n/);
    const memory = new Uint8Array(32768); // 32KB max for ATmega328P
    memory.fill(0xFF);
    let maxAddr = 0;

    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith(':')) continue;

      const byteCount = parseInt(line.substr(1, 2), 16);
      const address = parseInt(line.substr(3, 4), 16);
      const recordType = parseInt(line.substr(7, 2), 16);

      if (recordType === 0) { // Data Record
        for (let i = 0; i < byteCount; i++) {
          const byteVal = parseInt(line.substr(9 + i * 2, 2), 16);
          const currentAddr = address + i;
          if (currentAddr < memory.length) {
            memory[currentAddr] = byteVal;
            if (currentAddr > maxAddr) maxAddr = currentAddr;
          }
        }
      } else if (recordType === 1) { // EOF Record
        break;
      }
    }

    const totalBytes = maxAddr > 0 ? maxAddr + 1 : 0;
    return {
      data: memory.subarray(0, totalBytes),
      totalBytes
    };
  }

  /**
   * Read exact number of bytes with timeout
   */
  async readBytes(count, timeoutMs = 1500) {
    const buffer = [];
    const startTime = Date.now();

    while (buffer.length < count) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`STK500 Timeout waiting for ${count} bytes (received ${buffer.length})`);
      }
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          for (let b of value) buffer.push(b);
        }
      } catch (e) {
        if (!e.message.includes('timeout')) throw e;
      }
    }

    return new Uint8Array(buffer.slice(0, count));
  }

  /**
   * Send a command array and verify STK_INSYNC (0x14) and STK_OK (0x10)
   */
  async sendCmd(cmdBytes, expectBytes = 2) {
    await this.writer.write(new Uint8Array(cmdBytes));
    const response = await this.readBytes(expectBytes);

    if (response.length >= 2 && response[0] === this.STK_INSYNC && response[response.length - 1] === this.STK_OK) {
      return true;
    }
    return false;
  }

  /**
   * Perform hardware reset via DTR pulse to enter Optiboot bootloader
   */
  async resetBoard() {
    this.log('🔄 Triggering Arduino Uno DTR hardware reset...');
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await new Promise((r) => setTimeout(r, 250));
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
      await new Promise((r) => setTimeout(r, 50));
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await new Promise((r) => setTimeout(r, 200));
      this.log('✅ Hardware reset pulse completed.');
    } catch (e) {
      this.log('⚠️ DTR signal toggle warning: ' + e.message);
    }
  }

  /**
   * Flash Intel HEX binary content onto Arduino Uno
   */
  async flash(hexContent) {
    const { data: flashData, totalBytes } = STK500Flasher.parseHex(hexContent);

    if (totalBytes === 0) {
      throw new Error('Intel HEX parsing failed: no valid data records found.');
    }

    this.log(`📄 Parsed Intel HEX: ${totalBytes} bytes to flash.`);
    this.progress(5, 'Connecting to Optiboot...');

    // Ensure port is closed before opening at STK500 baud rate
    if (this.port.readable || this.port.writable) {
      try { await this.port.close(); } catch (_) {}
    }

    try {
      await this.port.open({ baudRate: 115200 });
    } catch (e) {
      if (!e.message.includes('already open')) {
        throw new Error(`Failed to open serial port: ${e.message}`);
      }
    }

    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();

    try {
      // Pulse DTR reset
      await this.resetBoard();

      // Sync attempt
      let synced = false;
      this.log('⚡ Synchronizing with STK500 bootloader (STK_GET_SYNC)...');
      for (let attempt = 1; attempt <= 15; attempt++) {
        try {
          const success = await this.sendCmd([this.STK_GET_SYNC, this.CRC_EOP]);
          if (success) {
            synced = true;
            this.log(`✅ STK500 sync established (Attempt ${attempt}).`);
            break;
          }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 50));
      }

      if (!synced) {
        throw new Error('Could not establish STK500 sync with Arduino Uno. Ensure correct COM port selected and board is in bootloader mode.');
      }

      // Enter programming mode
      this.progress(15, 'Entering programming mode...');
      this.log('🔓 Entering STK500 programming mode...');
      await this.sendCmd([this.STK_ENTER_PROGMODE, this.CRC_EOP]);

      // Flash in pages of PAGE_SIZE (128 bytes)
      const totalPages = Math.ceil(totalBytes / this.PAGE_SIZE);
      this.log(`⚡ Flashing ${totalBytes} bytes across ${totalPages} pages...`);

      for (let i = 0; i < totalPages; i++) {
        const pageAddrBytes = i * this.PAGE_SIZE;
        const wordAddr = pageAddrBytes / 2; // Optiboot 16-bit word address

        // Load Address Command
        const addrLow = wordAddr & 0xFF;
        const addrHigh = (wordAddr >> 8) & 0xFF;
        const addrSuccess = await this.sendCmd([this.STK_LOAD_ADDRESS, addrLow, addrHigh, this.CRC_EOP]);
        if (!addrSuccess) {
          throw new Error(`Failed to set address for page ${i + 1}`);
        }

        // Prepare page data
        const pageChunk = new Uint8Array(this.PAGE_SIZE);
        pageChunk.fill(0xFF);
        const slice = flashData.subarray(pageAddrBytes, pageAddrBytes + this.PAGE_SIZE);
        pageChunk.set(slice);

        // STK_PROG_PAGE command: STK_PROG_PAGE (0x64), sizeHigh, sizeLow, 'F' (0x46), data..., CRC_EOP
        const pageCmd = new Uint8Array(5 + this.PAGE_SIZE);
        pageCmd[0] = this.STK_PROG_PAGE;
        pageCmd[1] = (this.PAGE_SIZE >> 8) & 0xFF;
        pageCmd[2] = this.PAGE_SIZE & 0xFF;
        pageCmd[3] = 0x46; // 'F' for Flash
        pageCmd.set(pageChunk, 4);
        pageCmd[4 + this.PAGE_SIZE] = this.CRC_EOP;

        const progSuccess = await this.sendCmd(pageCmd);
        if (!progSuccess) {
          throw new Error(`Failed to flash page ${i + 1}`);
        }

        const pct = Math.floor(15 + ((i + 1) / totalPages) * 80);
        this.progress(pct, `Flashing page ${i + 1}/${totalPages} (${pct}%)`);
      }

      // Leave programming mode
      this.progress(98, 'Finalizing flash...');
      this.log('🔒 Leaving programming mode...');
      await this.sendCmd([this.STK_LEAVE_PROGMODE, this.CRC_EOP]);

      this.progress(100, 'Arduino Uno flashed successfully!');
      this.log('🎉 Flashing complete! Board is resetting to run new program.');

    } finally {
      // Release streams and close port
      try { if (this.reader) await this.reader.cancel(); } catch (_) {}
      try { if (this.reader) this.reader.releaseLock(); } catch (_) {}
      try { if (this.writer) this.writer.releaseLock(); } catch (_) {}
      try { await this.port.close(); } catch (_) {}
    }
  }
}

window.STK500Flasher = STK500Flasher;
