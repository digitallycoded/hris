// QR Code Management Module
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbw4_EdbH04pf7m7WnliwdVUGOOifZY8eE2QKdgVD686DSNVL_-CUSy434usgJhXnm-9/exec";

const DEFAULT_QR_LIFETIME_SECONDS = 300; // fallback when GAS returns true
const AUTO_REFRESH_LIMIT = 0;

let qrExpiry = 0;
let isLoadingQR = false;
let qrAutoRefreshCount = 0;
let qrAwaitingManualRefresh = false;
let qrRefreshStarted = false;

function getSelectedCompany() {
  const companySelect = document.getElementById("companySelect");
  return companySelect ? companySelect.value : "";
}

function getSelectedBranch() {
  const branchSelect = document.getElementById("branchSelect");
  return branchSelect ? branchSelect.value : "";
}

function saveSelectedLocation() {
  const company = getSelectedCompany();
  const branch = getSelectedBranch();

  if (company) {
    localStorage.setItem("selectedCompany", company);
  }

  if (branch) {
    localStorage.setItem("selectedBranch", branch);
  }
}

function parseQRExpiry(expiresAt) {
  if (expiresAt === true || expiresAt === "true") {
    return Math.floor(Date.now() / 1000) + DEFAULT_QR_LIFETIME_SECONDS;
  }

  const value = Number(expiresAt);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value > 1000000000) {
    return Math.floor(value);
  }

  return Math.floor(Date.now() / 1000) + value;
}

function setQRMessage(message) {
  const qrContainer = document.getElementById("attendanceQR");

  if (!qrContainer) return;

  qrContainer.innerHTML = `<div class="qr-placeholder">${message}</div>`;
}

function showQRRefreshPrompt(message = "Auto refresh limit reached. Refresh QR manually.") {
  const qrContainer = document.getElementById("attendanceQR");

  if (!qrContainer) return;

  qrContainer.innerHTML = `
    <div class="qr-placeholder qr-placeholder--manual">
      <div class="qr-status">
        <div>${message}</div>
        <button type="button" class="qr-refresh-btn" id="qrRefreshBtn">Refresh QR</button>
      </div>
    </div>
  `;

  document.getElementById("qrRefreshBtn")?.addEventListener("click", () => {
    qrAutoRefreshCount = 0;
    qrAwaitingManualRefresh = false;
    qrRefreshStarted = false;
    loadQR("manual");
  });
}

async function loadQR(source = "manual") {

  const qrContainer =
    document.getElementById("attendanceQR");

  const timer =
    document.getElementById("qrTimer");

  const company = getSelectedCompany();
  const branch = getSelectedBranch();

  if (!qrContainer) return;

  if (!company) {
    setQRMessage("Please select company");
    if (timer) timer.textContent = "";
    return;
  }

  if (!branch) {
    setQRMessage("Please select branch");
    if (timer) timer.textContent = "";
    return;
  }

  if (source === "auto") {
    if (qrAwaitingManualRefresh) {
      return;
    }

    if (qrAutoRefreshCount >= AUTO_REFRESH_LIMIT) {
      qrAwaitingManualRefresh = true;
      showQRRefreshPrompt();
      if (timer) timer.textContent = "Refresh needed";
      return;
    }

    qrAutoRefreshCount += 1;
  } else {
    qrAutoRefreshCount = 0;
    qrAwaitingManualRefresh = false;
  }

  // Inform the user we're fetching new QR data (only for manual refresh)
  if (source === "manual") {
    setQRMessage("Fetching QR data");
    if (timer) timer.textContent = "Fetching...";
  }

  try {
    isLoadingQR = true;

    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "getAttendanceQR",
        company,
        branch
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      const text = await response.text();
      console.error("Failed to parse QR response as JSON:", text);
      throw new Error("Invalid JSON response from QR endpoint");
    }

    const qrText = data?.qrData || data?.qr || data?.qrUrl;

    if (!data || !qrText) {
      throw new Error("Invalid QR response: missing qrData, qr, or qrUrl");
    }

    qrExpiry = parseQRExpiry(data.expiresAt);
    qrRefreshStarted = false;
    
    // Clear container and display new QR
    qrContainer.innerHTML = "";

    new QRCode(qrContainer, {
      text: qrText,
      width: 220,
      height: 220
    });

    qrAwaitingManualRefresh = false;
    saveSelectedLocation();

    // Update timer immediately with the new expiry
    if (timer && qrExpiry > 0) {
      const now = Math.floor(Date.now() / 1000);
      const remaining = qrExpiry - now;
      if (remaining > 0) {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      } else {
        timer.textContent = "00:00";
      }
    }

  } catch (err) {
    console.error("Error loading QR:", err);
    qrExpiry = 0;

    if (timer) {
      timer.textContent = "Unable to load QR";
    }
  } finally {
    isLoadingQR = false;
  }
}

function startGlobalTimer() {
  const timer = document.getElementById("qrTimer");

  if (!timer) return;

  if (window.qrIntervalId) {
    clearInterval(window.qrIntervalId);
  }

  window.qrIntervalId = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = qrExpiry - now;

    if (qrExpiry <= 0) {
      if (!isLoadingQR) {
        timer.textContent = "";
      }
      return;
    }

    if (remaining <= 0) {
      if (!isLoadingQR && !qrRefreshStarted) {
        if (qrAwaitingManualRefresh) {
          timer.textContent = "Refresh needed";
          return;
        }

        qrRefreshStarted = true;
        timer.textContent = "Refreshing...";
        await loadQR("auto");
      }
      return;
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    timer.textContent =
      `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, 1000);
}

function initializeQRHandlers() {
  const companySelect = document.getElementById("companySelect");
  const branchSelect = document.getElementById("branchSelect");

  companySelect?.addEventListener("change", () => {
    qrAutoRefreshCount = 0;
    qrAwaitingManualRefresh = false;
    qrRefreshStarted = false;
    populateBranchOptions();
    saveSelectedLocation();
    loadQR("manual");
  });

  branchSelect?.addEventListener("change", () => {
    qrAutoRefreshCount = 0;
    qrAwaitingManualRefresh = false;
    qrRefreshStarted = false;
    saveSelectedLocation();
    loadQR("manual");
  });
}
