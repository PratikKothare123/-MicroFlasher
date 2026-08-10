/**
 * Main Application Client Logic
 * Handles API requests, Web Serial port connections, Admin Authentication, Project Editing, Web Serial Monitor, and Flasher dispatching
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation & View Elements
  const tabUserBtn = document.getElementById('tab-user');
  const tabMonitorBtn = document.getElementById('tab-monitor');
  const tabAdminBtn = document.getElementById('tab-admin');
  
  const viewUser = document.getElementById('view-user');
  const viewMonitor = document.getElementById('view-monitor');
  const viewAdmin = document.getElementById('view-admin');
  const serialStatusBadge = document.getElementById('serial-status-badge');

  // User Catalog View Elements
  const searchInput = document.getElementById('search-input');
  const boardFilterSelect = document.getElementById('board-filter-select');
  const projectGrid = document.getElementById('project-grid');

  // Flasher Modal Elements
  const flashModal = document.getElementById('flash-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalProjectTitle = document.getElementById('modal-project-title');
  const modalProjectBoard = document.getElementById('modal-project-board');
  const modalProjectDesc = document.getElementById('modal-project-desc');
  const btnSelectPort = document.getElementById('btn-select-port');
  const selectedPortLabel = document.getElementById('selected-port-label');
  const selectBaudRate = document.getElementById('select-baud-rate');
  const btnFlashBinary = document.getElementById('btn-flash-binary');
  const flashProgressWrapper = document.getElementById('flash-progress-wrapper');
  const flashProgressBar = document.getElementById('flash-progress-bar');
  const flashProgressText = document.getElementById('flash-progress-text');
  const flashTerminal = document.getElementById('flash-terminal');
  const btnClearTerminal = document.getElementById('btn-clear-terminal');

  // Serial Monitor Elements
  const monBtnConnect = document.getElementById('mon-btn-connect');
  const monBtnDisconnect = document.getElementById('mon-btn-disconnect');
  const monPortLabel = document.getElementById('mon-port-label');
  const monSelectBaud = document.getElementById('mon-select-baud');
  const monTerminalBody = document.getElementById('mon-terminal-body');
  const monAutoscrollChk = document.getElementById('mon-autoscroll-chk');
  const monBtnClear = document.getElementById('mon-btn-clear');
  const monInputText = document.getElementById('mon-input-text');
  const monSelectLineEnding = document.getElementById('mon-select-line-ending');
  const monBtnSend = document.getElementById('mon-btn-send');

  // Admin Auth & Panel Elements
  const adminLoginCard = document.getElementById('admin-login-card');
  const adminLoginForm = document.getElementById('admin-login-form');
  const loginUsernameInput = document.getElementById('login-username');
  const loginPasswordInput = document.getElementById('login-password');
  const loginErrorAlert = document.getElementById('login-error-alert');

  const adminDashboardContent = document.getElementById('admin-dashboard-content');
  const adminUserDisplay = document.getElementById('admin-user-display');
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  const btnOpenChangePassword = document.getElementById('btn-open-change-password');

  const changePasswordModal = document.getElementById('change-password-modal');
  const changePassCloseBtn = document.getElementById('change-pass-close-btn');
  const changePasswordForm = document.getElementById('change-password-form');
  const passOldInput = document.getElementById('pass-old');
  const passNewInput = document.getElementById('pass-new');
  const passConfirmInput = document.getElementById('pass-confirm');
  const changePassAlert = document.getElementById('change-pass-alert');

  const editProjectModal = document.getElementById('edit-project-modal');
  const editModalCloseBtn = document.getElementById('edit-modal-close-btn');
  const editProjectForm = document.getElementById('edit-project-form');
  const editProjectIdInput = document.getElementById('edit-project-id');
  const editTitleInput = document.getElementById('edit-title');
  const editDescInput = document.getElementById('edit-desc');
  const editBoardSelect = document.getElementById('edit-board');
  const editProjectAlert = document.getElementById('edit-project-alert');

  const uploadForm = document.getElementById('upload-form');
  const uploadTitleInput = document.getElementById('upload-title');
  const uploadDescInput = document.getElementById('upload-desc');
  const uploadBoardSelect = document.getElementById('upload-board');
  const uploadFileInput = document.getElementById('upload-file');
  const uploadBtn = document.getElementById('upload-btn');
  const adminTerminal = document.getElementById('admin-terminal');
  const adminProjectsList = document.getElementById('admin-projects-list');

  // App State Variables
  let projectsList = [];
  let selectedProject = null;
  let currentSerialPort = null;
  let isFlashing = false;
  let adminToken = localStorage.getItem('adminToken') || null;
  let adminUsername = localStorage.getItem('adminUsername') || null;

  // Serial Monitor State Variables
  let monPort = null;
  let monReader = null;
  let monKeepReading = false;

  // Check Web Serial API Support
  checkWebSerialSupport();

  // Navigation Tab Event Listeners
  tabUserBtn.addEventListener('click', () => switchTab('user'));
  if (tabMonitorBtn) tabMonitorBtn.addEventListener('click', () => switchTab('monitor'));
  tabAdminBtn.addEventListener('click', () => switchTab('admin'));

  function switchTab(tab) {
    [tabUserBtn, tabMonitorBtn, tabAdminBtn].forEach(btn => btn && btn.classList.remove('active'));
    [viewUser, viewMonitor, viewAdmin].forEach(view => view && view.classList.add('hidden'));

    if (tab === 'user') {
      tabUserBtn.classList.add('active');
      viewUser.classList.remove('hidden');
      fetchProjects();
    } else if (tab === 'monitor') {
      tabMonitorBtn.classList.add('active');
      viewMonitor.classList.remove('hidden');
    } else {
      tabAdminBtn.classList.add('active');
      viewAdmin.classList.remove('hidden');
      checkAdminSession();
    }
  }

  function checkWebSerialSupport() {
    if ('serial' in navigator) {
      serialStatusBadge.innerHTML = `<span class="dot green"></span> Web Serial Ready`;
      serialStatusBadge.className = 'status-badge ready';
    } else {
      serialStatusBadge.innerHTML = `<span class="dot red"></span> Web Serial Unsupported (Use Chrome/Edge)`;
      serialStatusBadge.className = 'status-badge unsupported';
    }
  }

  // ==========================================
  // ADMIN AUTHENTICATION LOGIC
  // ==========================================

  async function checkAdminSession() {
    if (!adminToken) {
      showLoginView();
      return;
    }

    try {
      const res = await fetch('/api/admin/verify', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      if (res.ok) {
        const data = await res.json();
        adminUsername = data.username;
        localStorage.setItem('adminUsername', adminUsername);
        showDashboardView();
      } else {
        clearAdminToken();
        showLoginView();
      }
    } catch (_) {
      showDashboardView();
    }
  }

  function showLoginView() {
    adminLoginCard.classList.remove('hidden');
    adminDashboardContent.classList.add('hidden');
    loginErrorAlert.classList.add('hidden');
  }

  function showDashboardView() {
    adminLoginCard.classList.add('hidden');
    adminDashboardContent.classList.remove('hidden');
    adminUserDisplay.textContent = adminUsername || 'admin';
    fetchProjectsAdmin();
    checkServerHealth();
  }

  function clearAdminToken() {
    adminToken = null;
    adminUsername = null;
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUsername');
  }

  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    loginErrorAlert.classList.add('hidden');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        loginErrorAlert.textContent = data.error || 'Login failed.';
        loginErrorAlert.classList.remove('hidden');
        return;
      }

      adminToken = data.token;
      adminUsername = data.username;
      localStorage.setItem('adminToken', adminToken);
      localStorage.setItem('adminUsername', adminUsername);

      adminLoginForm.reset();
      showDashboardView();

    } catch (err) {
      loginErrorAlert.textContent = 'Network error during login: ' + err.message;
      loginErrorAlert.classList.remove('hidden');
    }
  });

  btnAdminLogout.addEventListener('click', () => {
    clearAdminToken();
    showLoginView();
  });

  // Change Password Modal Handlers
  btnOpenChangePassword.addEventListener('click', () => {
    changePasswordForm.reset();
    changePassAlert.classList.add('hidden');
    changePasswordModal.classList.remove('hidden');
  });

  changePassCloseBtn.addEventListener('click', () => {
    changePasswordModal.classList.add('hidden');
  });

  changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = passOldInput.value;
    const newPassword = passNewInput.value;
    const confirmPassword = passConfirmInput.value;

    changePassAlert.classList.add('hidden');

    if (newPassword !== confirmPassword) {
      changePassAlert.className = 'alert-box error';
      changePassAlert.textContent = 'New password and confirmation do not match.';
      changePassAlert.classList.remove('hidden');
      return;
    }

    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ oldPassword, newPassword })
      });

      const data = await res.json();

      if (!res.ok) {
        changePassAlert.className = 'alert-box error';
        changePassAlert.textContent = data.error || 'Failed to update password.';
        changePassAlert.classList.remove('hidden');
        return;
      }

      changePassAlert.className = 'alert-box success';
      changePassAlert.textContent = '🎉 Password changed successfully!';
      changePassAlert.classList.remove('hidden');

      setTimeout(() => {
        changePasswordModal.classList.add('hidden');
      }, 1500);

    } catch (err) {
      changePassAlert.className = 'alert-box error';
      changePassAlert.textContent = 'Error: ' + err.message;
      changePassAlert.classList.remove('hidden');
    }
  });

  // Edit Project Modal Handlers
  editModalCloseBtn.addEventListener('click', () => {
    editProjectModal.classList.add('hidden');
  });

  function openEditProjectModal(project) {
    if (!project) return;
    editProjectIdInput.value = project.id;
    editTitleInput.value = project.title || '';
    editDescInput.value = project.description || '';
    editBoardSelect.value = project.board_type || 'esp32:esp32:esp32';
    editProjectAlert.classList.add('hidden');
    editProjectModal.classList.remove('hidden');
  }

  editProjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editProjectIdInput.value;
    const title = editTitleInput.value.trim();
    const description = editDescInput.value.trim();
    const board_type = editBoardSelect.value;

    editProjectAlert.classList.add('hidden');

    try {
      const res = await fetch(`/api/admin/projects/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ title, description, board_type })
      });

      const data = await res.json();

      if (!res.ok) {
        editProjectAlert.className = 'alert-box error';
        editProjectAlert.textContent = data.error || 'Failed to update project.';
        editProjectAlert.classList.remove('hidden');
        return;
      }

      editProjectAlert.className = 'alert-box success';
      editProjectAlert.textContent = '🎉 Project updated successfully!';
      editProjectAlert.classList.remove('hidden');

      setTimeout(() => {
        editProjectModal.classList.add('hidden');
        fetchProjectsAdmin();
        fetchProjects();
      }, 1000);

    } catch (err) {
      editProjectAlert.className = 'alert-box error';
      editProjectAlert.textContent = 'Error: ' + err.message;
      editProjectAlert.classList.remove('hidden');
    }
  });

  // ==========================================
  // CATALOG & USER DASHBOARD
  // ==========================================

  async function fetchProjects() {
    try {
      projectGrid.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading projects...</p></div>`;
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to load projects');
      projectsList = await res.json();
      renderProjectsGrid();
    } catch (err) {
      projectGrid.innerHTML = `<div class="empty-state">❌ Error loading project catalog: ${err.message}</div>`;
    }
  }

  function renderProjectsGrid() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const boardFilter = boardFilterSelect.value;

    const filtered = projectsList.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchTerm) || p.description.toLowerCase().includes(searchTerm);
      const matchesBoard = !boardFilter || p.board_type.includes(boardFilter);
      return matchesSearch && matchesBoard;
    });

    if (filtered.length === 0) {
      projectGrid.innerHTML = `<div class="empty-state">No microcontroller projects found matching your filter criteria.</div>`;
      return;
    }

    projectGrid.innerHTML = filtered.map(p => `
      <div class="project-card" data-id="${p.id}">
        <div class="card-header">
          <span class="board-pill ${getBoardBadgeClass(p.board_type)}">${formatBoardName(p.board_type)}</span>
          <span class="file-tag">${p.file_type.toUpperCase()}</span>
        </div>
        <h3 class="card-title">${escapeHtml(p.title)}</h3>
        <p class="card-desc">${escapeHtml(p.description)}</p>
        <div class="card-footer">
          <span class="date-text">${new Date(p.created_at).toLocaleDateString()}</span>
          <button class="btn btn-primary btn-sm open-flash-btn" data-id="${p.id}">
            🔌 Connect & Flash
          </button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.open-flash-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openFlashModal(id);
      });
    });
  }

  searchInput.addEventListener('input', renderProjectsGrid);
  boardFilterSelect.addEventListener('change', renderProjectsGrid);

  function formatBoardName(fqbn) {
    if (fqbn.includes('uno') || fqbn.includes('avr')) return 'Arduino Uno';
    if (fqbn.includes('esp32')) return 'ESP32';
    if (fqbn.includes('esp8266')) return 'ESP8266';
    return fqbn;
  }

  function getBoardBadgeClass(fqbn) {
    if (fqbn.includes('uno') || fqbn.includes('avr')) return 'uno-badge';
    if (fqbn.includes('esp32')) return 'esp32-badge';
    if (fqbn.includes('esp8266')) return 'esp8266-badge';
    return 'custom-badge';
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // ==========================================
  // FLASHING MODAL & WEB SERIAL INTERACTION
  // ==========================================

  function openFlashModal(projectId) {
    selectedProject = projectsList.find(p => p.id === projectId);
    if (!selectedProject) return;

    modalProjectTitle.textContent = selectedProject.title;
    modalProjectBoard.textContent = formatBoardName(selectedProject.board_type);
    modalProjectBoard.className = `board-pill ${getBoardBadgeClass(selectedProject.board_type)}`;
    modalProjectDesc.textContent = selectedProject.description;

    selectBaudRate.value = '115200';
    resetFlasherUI();
    flashModal.classList.remove('hidden');
  }

  function closeFlashModal() {
    if (isFlashing) {
      if (!confirm('Flashing is currently in progress. Are you sure you want to exit?')) return;
    }
    flashModal.classList.add('hidden');
    selectedProject = null;
  }

  modalCloseBtn.addEventListener('click', closeFlashModal);

  function resetFlasherUI() {
    flashProgressWrapper.classList.add('hidden');
    flashProgressBar.style.width = '0%';
    flashProgressText.textContent = '0%';
    flashTerminal.innerHTML = `<div class="log-line info">Ready to connect serial port and flash firmware binary.</div>`;
    btnFlashBinary.disabled = !currentSerialPort;
  }

  btnSelectPort.addEventListener('click', async () => {
    if (!('serial' in navigator)) {
      alert('Web Serial API is not supported in this browser. Please open this app in Google Chrome or Microsoft Edge.');
      return;
    }

    try {
      // Disconnect Serial Monitor if currently active to avoid COM port locks
      if (monPort) {
        await disconnectSerialMonitor();
        logToTerminal('info', 'ℹ️ Automatically disconnected Serial Monitor to allow Flasher port access.');
      }

      currentSerialPort = await navigator.serial.requestPort();
      const info = currentSerialPort.getInfo();
      const portText = info.usbVendorId ? `USB Device (VID: 0x${info.usbVendorId.toString(16).padStart(4, '0')})` : 'Selected Serial COM Port';
      selectedPortLabel.textContent = `🟢 ${portText}`;
      selectedPortLabel.classList.add('connected');
      btnFlashBinary.disabled = false;
      logToTerminal('success', `Connected to Web Serial Port: ${portText}`);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        logToTerminal('error', `Port Selection Failed: ${err.message}`);
      }
    }
  });

  btnFlashBinary.addEventListener('click', async () => {
    if (!selectedProject || !currentSerialPort) {
      alert('Please select a valid COM port first.');
      return;
    }

    // Auto disconnect serial monitor if running
    if (monPort) {
      await disconnectSerialMonitor();
      logToTerminal('info', 'ℹ️ Disconnected Serial Monitor to free COM port for flashing.');
    }

    isFlashing = true;
    btnFlashBinary.disabled = true;
    btnSelectPort.disabled = true;
    flashProgressWrapper.classList.remove('hidden');
    updateProgress(0, 'Fetching compiled binary from server storage...');

    try {
      logToTerminal('info', `Downloading protected compiled binary for project "${selectedProject.title}"...`);
      const binaryRes = await fetch(`/api/projects/${selectedProject.id}/binary`);
      if (!binaryRes.ok) throw new Error('Failed to download binary file from server.');

      const baudRate = parseInt(selectBaudRate.value, 10);
      const isUno = selectedProject.board_type.includes('uno') || selectedProject.board_type.includes('avr');

      if (isUno) {
        const hexText = await binaryRes.text();
        logToTerminal('info', `Initializing STK500v1 serial protocol flasher at ${baudRate} baud...`);
        const flasher = new window.STK500Flasher(
          currentSerialPort,
          (msg) => logToTerminal('info', msg),
          (pct, status) => updateProgress(pct, status)
        );
        await flasher.flash(hexText);

      } else {
        const binBuffer = await binaryRes.arrayBuffer();
        logToTerminal('info', `Initializing ESP Web Serial Flasher at ${baudRate} baud...`);
        const flasher = new window.ESPFlasher(
          currentSerialPort,
          (msg) => logToTerminal('info', msg),
          (pct, status) => updateProgress(pct, status)
        );
        await flasher.flash(binBuffer, selectedProject.board_type, baudRate);
      }

      logToTerminal('success', '🎉 Microcontroller successfully flashed without source code exposure!');

    } catch (err) {
      let errMsg = err.message || String(err);
      if (errMsg.includes('Failed to open serial port') || errMsg.includes('Failed to execute \'open\'')) {
        errMsg = `Failed to open serial port: The COM port is currently open in another window, tab, or program (e.g. Serial Monitor or Arduino IDE). Please disconnect it or close other serial tools and try again.`;
      }
      logToTerminal('error', `❌ Flashing Failed: ${errMsg}`);
      updateProgress(0, `Flashing Failed: ${errMsg}`);
    } finally {
      isFlashing = false;
      btnFlashBinary.disabled = false;
      btnSelectPort.disabled = false;
    }
  });

  function updateProgress(pct, text) {
    flashProgressBar.style.width = `${pct}%`;
    flashProgressText.textContent = `${pct}% - ${text}`;
  }

  function logToTerminal(type, text) {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${text}`;
    flashTerminal.appendChild(line);
    flashTerminal.scrollTop = flashTerminal.scrollHeight;
  }

  btnClearTerminal.addEventListener('click', () => {
    flashTerminal.innerHTML = '';
  });

  // ==========================================
  // WEB SERIAL MONITOR CONTROLLER
  // ==========================================

  monBtnConnect.addEventListener('click', async () => {
    if (!('serial' in navigator)) {
      alert('Web Serial API is not supported in this browser.');
      return;
    }

    try {
      // Clear flasher port selection to prevent port locks
      currentSerialPort = null;

      monPort = await navigator.serial.requestPort();
      const baudRate = parseInt(monSelectBaud.value, 10);

      try {
        await monPort.open({ baudRate });
      } catch (openErr) {
        if (openErr.message.includes('Failed to open serial port') || openErr.message.includes('Failed to execute \'open\'')) {
          throw new Error('The selected COM port is currently open in another program (e.g. Arduino IDE, Flasher tool, or another tab). Please close other serial connections and try again.');
        }
        throw openErr;
      }

      const info = monPort.getInfo();
      const portText = info.usbVendorId ? `USB Device (VID: 0x${info.usbVendorId.toString(16).padStart(4, '0')})` : 'Connected COM Port';
      
      monPortLabel.textContent = `🟢 ${portText} @ ${baudRate} Baud`;
      monPortLabel.classList.add('connected');

      monBtnConnect.classList.add('hidden');
      monBtnDisconnect.classList.remove('hidden');
      monInputText.disabled = false;
      monBtnSend.disabled = false;

      logToSerialTerminal('success', `🔌 Connected to ${portText} at ${baudRate} baud.`);

      monKeepReading = true;
      readSerialStream();

    } catch (err) {
      if (err.name !== 'NotFoundError') {
        logToSerialTerminal('error', `Serial Connection Error: ${err.message}`);
      }
    }
  });

  monBtnDisconnect.addEventListener('click', async () => {
    await disconnectSerialMonitor();
  });

  async function disconnectSerialMonitor() {
    monKeepReading = false;
    if (monReader) {
      try {
        await monReader.cancel();
      } catch (_) {}
    }

    if (monPort) {
      try {
        await monPort.close();
      } catch (_) {}
      monPort = null;
    }

    monPortLabel.textContent = 'No port connected';
    monPortLabel.classList.remove('connected');

    monBtnConnect.classList.remove('hidden');
    monBtnDisconnect.classList.add('hidden');
    monInputText.disabled = true;
    monBtnSend.disabled = true;

    logToSerialTerminal('info', 'Disconnected from serial port.');
  }

  async function readSerialStream() {
    while (monPort && monPort.readable && monKeepReading) {
      try {
        const textDecoder = new TextDecoderStream();
        monPort.readable.pipeTo(textDecoder.writable).catch(() => {});
        monReader = textDecoder.readable.getReader();

        let partialLine = '';

        while (true) {
          const { value, done } = await monReader.read();
          if (done) break;
          if (value) {
            partialLine += value;
            const lines = partialLine.split('\n');
            partialLine = lines.pop(); // Keep unfinished line fragment

            lines.forEach(lineText => {
              logToSerialTerminal('serial', lineText.replace('\r', ''));
            });
          }
        }
      } catch (err) {
        if (monKeepReading) {
          logToSerialTerminal('error', `Serial Read Error: ${err.message}`);
        }
      } finally {
        if (monReader) {
          monReader.releaseLock();
          monReader = null;
        }
      }
    }
  }

  async function sendSerialCommand() {
    if (!monPort || !monPort.writable) {
      alert('Serial port is not connected.');
      return;
    }

    let payload = monInputText.value;
    if (!payload && payload !== '') return;

    const ending = monSelectLineEnding.value.replace('\\r', '\r').replace('\\n', '\n');
    payload += ending;

    try {
      const encoder = new TextEncoder();
      const writer = monPort.writable.getWriter();
      await writer.write(encoder.encode(payload));
      writer.releaseLock();

      logToSerialTerminal('info', `📤 Sent: ${monInputText.value}`);
      monInputText.value = '';

    } catch (err) {
      logToSerialTerminal('error', `Failed to send serial data: ${err.message}`);
    }
  }

  monBtnSend.addEventListener('click', sendSerialCommand);
  monInputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendSerialCommand();
  });

  monBtnClear.addEventListener('click', () => {
    monTerminalBody.innerHTML = '';
  });

  function logToSerialTerminal(type, text) {
    if (!text && text !== '') return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${text}`;
    monTerminalBody.appendChild(line);

    if (monAutoscrollChk.checked) {
      monTerminalBody.scrollTop = monTerminalBody.scrollHeight;
    }
  }

  // ==========================================
  // ADMIN PANEL & COMPILATION PIPELINE
  // ==========================================

  async function checkServerHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (!data.arduinoCliInstalled) {
        logToAdminTerminal('warning', '⚠️ Server Warning: `arduino-cli` was not detected in host system PATH. Compilation uploads will fail until arduino-cli is installed on the server host.');
      }
    } catch (_) {}
  }

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = uploadTitleInput.value.trim();
    const description = uploadDescInput.value.trim();
    const board_type = uploadBoardSelect.value;
    const file = uploadFileInput.files[0];

    if (!title || !description || !board_type || !file) {
      alert('Please fill out all fields and select a valid file.');
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('board_type', board_type);
    formData.append('ino_file', file);

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = `<span class="spinner-sm"></span> Processing upload...`;
    logToAdminTerminal('info', `🚀 Uploading file "${file.name}" for target "${board_type}"...`);

    try {
      const res = await fetch('/api/admin/upload-project', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        logToAdminTerminal('error', `❌ Upload/Compilation Failed:\n${data.error}\n\nLogs:\n${data.logs || 'No log details available.'}`);
        alert(`Error: ${data.error}`);
        return;
      }

      logToAdminTerminal('success', `✅ Processing & Publishing Successful!\nProject ID: ${data.project.id}\nBinary Type: .${data.project.file_type.toUpperCase()}\n\nLogs:\n${data.logs}`);
      alert('🎉 Project successfully published to catalog!');

      uploadForm.reset();
      fetchProjectsAdmin();

    } catch (err) {
      logToAdminTerminal('error', `❌ Server Communication Error: ${err.message}`);
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = `⚙️ Process & Publish Binary`;
    }
  });

  async function fetchProjectsAdmin() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      projectsList = data; // Assign data to global projectsList
      renderAdminProjectsTable(data);
    } catch (err) {
      adminProjectsList.innerHTML = `<tr><td colspan="5">Error loading projects: ${err.message}</td></tr>`;
    }
  }

  function renderAdminProjectsTable(projects) {
    projectsList = projects; // Update projectsList
    if (projects.length === 0) {
      adminProjectsList.innerHTML = `<tr><td colspan="5" class="text-center">No projects published yet. Upload your first sketch or binary above.</td></tr>`;
      return;
    }

    adminProjectsList.innerHTML = projects.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.title)}</strong></td>
        <td><span class="board-pill ${getBoardBadgeClass(p.board_type)}">${formatBoardName(p.board_type)}</span></td>
        <td>.${p.file_type.toUpperCase()}</td>
        <td>${new Date(p.created_at).toLocaleString()}</td>
        <td>
          <button class="btn btn-secondary btn-sm edit-project-btn" data-id="${p.id}" style="margin-right: 0.3rem;">✏️ Edit</button>
          <button class="btn btn-danger btn-sm delete-project-btn" data-id="${p.id}">🗑️ Delete</button>
        </td>
      </tr>
    `).join('');
  }

  // Event Delegation for Admin Projects Table Actions
  adminProjectsList.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.edit-project-btn');
    const deleteBtn = e.target.closest('.delete-project-btn');

    if (editBtn) {
      const id = editBtn.getAttribute('data-id');
      let proj = projectsList.find(p => p.id === id);
      
      if (!proj) {
        try {
          const res = await fetch('/api/projects');
          projectsList = await res.json();
          proj = projectsList.find(p => p.id === id);
        } catch (_) {}
      }

      if (proj) {
        openEditProjectModal(proj);
      } else {
        alert('Could not find project details for editing.');
      }
    } else if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      if (confirm('Are you sure you want to delete this project and its binary file?')) {
        await deleteProject(id);
      }
    }
  });

  async function deleteProject(id) {
    try {
      const res = await fetch(`/api/admin/projects/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (!res.ok) throw new Error('Failed to delete project.');
      fetchProjectsAdmin();
      logToAdminTerminal('info', `Deleted project record ${id}`);
    } catch (err) {
      alert(`Delete Error: ${err.message}`);
    }
  }

  function logToAdminTerminal(type, text) {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${text}`;
    adminTerminal.appendChild(line);
    adminTerminal.scrollTop = adminTerminal.scrollHeight;
  }

  // Initial catalog load
  fetchProjects();
});
