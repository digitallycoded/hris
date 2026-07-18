const GAS_URL =
  "https://script.google.com/macros/s/AKfycbw4_EdbH04pf7m7WnliwdVUGOOifZY8eE2QKdgVD686DSNVL_-CUSy434usgJhXnm-9/exec";

let COMPANY_BRANCHES = {};

function normalizeBranchList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,|]/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeCompanyBranchesPayload(payload) {
  if (!payload) {
    return null;
  }

  if (payload.success && payload.data) {
    return normalizeCompanyBranchesPayload(payload.data);
  }

  if (Array.isArray(payload)) {
    const normalized = {};

    payload.forEach(item => {
      if (!item || typeof item !== "object") {
        return;
      }

      const companyName = item.company || item.name || item.label || item[0];
      if (!companyName) {
        return;
      }

      const branches = normalizeBranchList(item.branches || item.branch || item.values || item[1]);
      normalized[String(companyName)] = branches;
    });

    return Object.keys(normalized).length ? normalized : null;
  }

  if (typeof payload === "object") {
    const normalized = {};

    Object.entries(payload).forEach(([companyName, branches]) => {
      if (!companyName) {
        return;
      }

      normalized[String(companyName)] = normalizeBranchList(branches);
    });

    return Object.keys(normalized).length ? normalized : null;
  }

  return null;
}

function parseCompanyBranchesPayload(text) {
  if (!text) {
    return null;
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return null;
  }

  try {
    return normalizeCompanyBranchesPayload(JSON.parse(trimmedText));
  } catch (parseErr) {
    console.warn("Could not parse companies response as JSON", trimmedText);
  }

  const match = trimmedText.match(/\{\s*([\s\S]+)\s*\}/);
  if (!match) {
    return null;
  }

  const body = match[1];
  const entries = body.split(/,\s*/).map(pair => pair.split(/=\s*/));
  const result = {};

  for (const [key, value] of entries) {
    if (!key) {
      continue;
    }

    const cleanedKey = key.replace(/[^\w\- ]/g, "").trim();
    const cleanedValue = value
      ?.replace(/^[\[\s]+|[\]\s]+$/g, "")
      .split(/,\s*/)
      .map(item => item.trim())
      .filter(Boolean) || [];

    result[cleanedKey] = cleanedValue;
  }

  return Object.keys(result).length ? result : null;
}

async function fetchCompaniesAndBranches() {
  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "getCompaniesAndBranches"
      })
    });

    const text = await response.text();
    const payload = parseCompanyBranchesPayload(text);

    if (payload) {
      COMPANY_BRANCHES = payload;
      localStorage.setItem("companyBranches", JSON.stringify(COMPANY_BRANCHES));
    } else {
      const storedPayload = localStorage.getItem("companyBranches");
      if (storedPayload) {
        try {
          COMPANY_BRANCHES = JSON.parse(storedPayload);
        } catch (err) {
          COMPANY_BRANCHES = {};
        }
      } else {
        console.warn("Failed to load companies and branches", text);
        COMPANY_BRANCHES = {};
      }
    }
  } catch (err) {
    console.error("Unable to fetch companies and branches", err);
    const storedPayload = localStorage.getItem("companyBranches");
    if (storedPayload) {
      try {
        COMPANY_BRANCHES = JSON.parse(storedPayload);
      } catch (parseErr) {
        COMPANY_BRANCHES = {};
      }
    } else {
      COMPANY_BRANCHES = {};
    }
  }
}

function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || "",
    language: navigator.language || "",
    vendor: navigator.vendor || "",
    appVersion: navigator.appVersion || "",
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    isMobile: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    screen: {
      width: window.screen?.width ?? null,
      height: window.screen?.height ?? null,
      colorDepth: window.screen?.colorDepth ?? null
    }
  };
}

function getCurrentLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({
        latitude: null,
        longitude: null,
        accuracy: null,
        locationError: "Geolocation is not supported by this browser."
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude ?? null,
          longitude: position.coords.longitude ?? null,
          accuracy: position.coords.accuracy ?? null,
          locationError: null
        });
      },
      error => {
        resolve({
          latitude: null,
          longitude: null,
          accuracy: null,
          locationError: error?.message || "Unable to get current location."
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

async function submitAttendanceVerification(qrToken, statusElement) {
  if (!qrToken) {
    if (statusElement) {
      statusElement.textContent = "Please enter or scan a QR code first.";
    }
    return;
  }

  if (statusElement) {
    statusElement.textContent = "Verifying attendance...";
  }

  const employeeData = localStorage.getItem("employee");
  const employee = employeeData ? JSON.parse(employeeData) : null;
  const userId = localStorage.getItem("userId") || employee?.employeeId || localStorage.getItem("employeeId") || "";
  if (!userId) {
      statusElement.textContent = "Employee not logged in.";
      return false;
  }
  const timestamp = new Date().toISOString();
  const location = await getCurrentLocation();

  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "verifyAttendance",
        userId,
        timestamp,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        qrToken,
        deviceInfo: getDeviceInfo(),
        locationError: location.locationError
      })
    });

    const text = await response.text();
    let data = null;

    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error("Failed to parse attendance verification response:", text);
      throw new Error("Invalid JSON response from attendance verification endpoint.");
    }

    if (data?.success) {
      const message = data.message || "Attendance verified successfully.";
      if (statusElement) {
        statusElement.textContent = message;
      }
      return true;
    }

    const message = data?.message || "Attendance verification failed.";
    if (statusElement) {
      statusElement.textContent = message;
    }
    return false;
  } catch (error) {
    console.error("Attendance verification request failed:", error);
    if (statusElement) {
      statusElement.textContent = "Attendance verification failed. Please try again.";
    }
    return false;
  }
}

function normalizeEmployeeProfile(rawEmployee, rawGovt, fallbackEmployeeId = "") {
  const sourceEmployee = rawEmployee && typeof rawEmployee === "object" && !Array.isArray(rawEmployee)
    ? rawEmployee
    : {};
  const sourceGovt = rawGovt && typeof rawGovt === "object" && !Array.isArray(rawGovt)
    ? rawGovt
    : {};
  const employeeArray = Array.isArray(rawEmployee) ? rawEmployee : [];
  const govtArray = Array.isArray(rawGovt) ? rawGovt : [];
  const govtData = sourceEmployee.govt && typeof sourceEmployee.govt === "object"
    ? sourceEmployee.govt
    : sourceGovt;

  const employeeIdValue = sourceEmployee.employeeId
    ?? sourceEmployee.employee_id
    ?? sourceEmployee.empId
    ?? sourceEmployee.id
    ?? fallbackEmployeeId
    ?? "";

  return {
    ...sourceEmployee,
    employeeId: employeeIdValue,
    firstname: sourceEmployee.firstname ?? sourceEmployee.firstName ?? employeeArray[1] ?? "",
    middlename: sourceEmployee.middlename ?? sourceEmployee.middleName ?? employeeArray[2] ?? "",
    surname: sourceEmployee.surname ?? sourceEmployee.lastName ?? employeeArray[3] ?? "",
    birthdate: sourceEmployee.birthdate ?? employeeArray[4] ?? "",
    company: sourceEmployee.company ?? employeeArray[5] ?? "",
    branch: sourceEmployee.branch ?? employeeArray[6] ?? "",
    position: sourceEmployee.position ?? employeeArray[7] ?? "",
    dateHired: sourceEmployee.dateHired ?? sourceEmployee.date_hired ?? employeeArray[8] ?? "",
    rate: sourceEmployee.rate ?? employeeArray[9] ?? "",
    schedule: sourceEmployee.schedule ?? employeeArray[10] ?? "",
    email: sourceEmployee.email ?? employeeArray[11] ?? "",
    contact: sourceEmployee.contact ?? employeeArray[12] ?? "",
    govt: {
      ...(sourceEmployee.govt && typeof sourceEmployee.govt === "object" ? sourceEmployee.govt : {}),
      sss: govtData?.sss ?? govtArray[1] ?? "",
      philH: govtData?.philH ?? govtData?.philhealth ?? govtArray[2] ?? "",
      pagIbig: govtData?.pagIbig ?? govtData?.pagibig ?? govtArray[3] ?? "",
      tin: govtData?.tin ?? govtArray[4] ?? "",
      tax: govtData?.tax ?? govtArray[5] ?? "",
      depend: govtData?.depend ?? govtArray[6] ?? "",
      bank: govtData?.bank ?? govtArray[7] ?? "",
      bAccount: govtData?.bAccount ?? govtData?.bankAccount ?? govtArray[8] ?? ""
    }
  };
}

async function login(){


  try{

    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "login",
        username: document.getElementById("username").value,
        password: document.getElementById("password").value
      })
    });

    const text = await res.text();   // IMPORTANT DEBUG STEP

    console.log("RAW RESPONSE:", text);

    const data = JSON.parse(text);

    if(data.success){

      localStorage.setItem("token", data.token);
      localStorage.setItem("role", data.role);
      localStorage.setItem("userId", data.userId);

      if (data.employee || data.govt) {
        const normalizedEmployee = normalizeEmployeeProfile(data.employee, data.govt, data.employeeId || data.employee?.employeeId || "");
        localStorage.setItem("employee", JSON.stringify(normalizedEmployee));
        if (normalizedEmployee.employeeId) {
          localStorage.setItem("employeeId", normalizedEmployee.employeeId);
        }
        const fullName = `${normalizedEmployee.firstname || ""} ${normalizedEmployee.surname || ""}`.trim();
        if (fullName) {
          localStorage.setItem("accountName", fullName);
        }
      }

      if(data.role === "ADMIN" || data.role === "HR"){
        window.location.href = "admin-dashboard.html";
      }else{
        window.location.href = "dashboard.html";
      }

    }else{
      document.getElementById("msg").innerText = data.message;
    }

  }catch(err){

    console.error(err);
    document.getElementById("msg").innerText =
      "Server error. Check GAS deployment.";

  }
}

function requireAuth(){

  const token = localStorage.getItem("token");

  if(!token){
    window.location.href = "index.html";
  }

}

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

function populateBranchOptions() {
  const company = getSelectedCompany();
  const branchSelect = document.getElementById("branchSelect");

  if (!branchSelect) return;

  const branches = COMPANY_BRANCHES[company] || [];
  branchSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = company ? "Select Branch" : "Select Company first";
  placeholder.disabled = true;
  placeholder.selected = true;
  branchSelect.appendChild(placeholder);

  branches.forEach(branch => {
    const option = document.createElement("option");
    option.value = branch;
    option.textContent = branch;
    branchSelect.appendChild(option);
  });

  branchSelect.disabled = !company;

  if (!company) {
    return;
  }

  const savedBranch = localStorage.getItem("selectedBranch");
  if (savedBranch && branches.includes(savedBranch)) {
    branchSelect.value = savedBranch;
  } else if (branches.length === 1) {
    branchSelect.value = branches[0];
  }
}

function populateCompanyOptions() {
  const companySelect = document.getElementById("companySelect");

  if (!companySelect) return;

  companySelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select Company";
  placeholder.disabled = true;
  placeholder.selected = true;
  companySelect.appendChild(placeholder);

  const companies = Object.keys(COMPANY_BRANCHES).sort();

  companies.forEach(company => {
    const option = document.createElement("option");
    option.value = company;
    option.textContent = company;
    companySelect.appendChild(option);
  });

  const savedCompany = localStorage.getItem("selectedCompany");

  if (savedCompany && COMPANY_BRANCHES[savedCompany]) {
    companySelect.value = savedCompany;
  } else if (companies.length === 1) {
    companySelect.value = companies[0];
  }

  populateBranchOptions();
}

const DEFAULT_QR_LIFETIME_SECONDS = 300; // fallback when GAS returns true
const AUTO_REFRESH_LIMIT = 2;
let qrExpiry = 0;
let isLoadingQR = false;
let qrAutoRefreshCount = 0;
let qrAwaitingManualRefresh = false;
let qrRefreshStarted = false;

function getQrContainer() {
  return document.getElementById("attendanceQR") || document.getElementById("qrContainer");
}

function setQRMessage(message) {
  const qrContainer = getQrContainer();

  if (!qrContainer) return;

  qrContainer.innerHTML = `<div class="qr-placeholder">${message}</div>`;
  qrContainer.style.display = "block";
}

function showQRRefreshPrompt(message = "Auto refresh limit reached. Refresh QR manually.") {
  const qrContainer = getQrContainer();

  if (!qrContainer) return;

  qrContainer.innerHTML = `
    <div class="qr-placeholder qr-placeholder--manual">
      <div class="qr-status">
        <div>${message}</div>
        <button type="button" class="qr-refresh-btn" id="qrRefreshBtn">Refresh QR</button>
      </div>
    </div>
  `;
  qrContainer.style.display = "block";

  document.getElementById("qrRefreshBtn")?.addEventListener("click", () => {
    qrAutoRefreshCount = 0;
    qrAwaitingManualRefresh = false;
    qrRefreshStarted = false;
    loadQR("manual");
  });
}

async function loadQR(source = "manual") {

  const qrContainer = getQrContainer();

  const timer =
    document.getElementById("qrTimer");

  const company = getSelectedCompany();
  const branch = getSelectedBranch();

  if (!qrContainer) return;

  if (!company) {
    setQRMessage("Please select company");
    if (timer) {
      timer.textContent = "00:00";
      timer.style.display = "block";
    }
    return;
  }

  if (!branch) {
    setQRMessage("Please select branch");
    if (timer) {
      timer.textContent = "00:00";
      timer.style.display = "block";
    }
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
    if (timer) {
      timer.textContent = "Fetching...";
      timer.style.display = "block";
    }
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
    qrContainer.style.display = "block";

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
        timer.style.display = "block"; // Ensure timer is visible
      } else {
        timer.textContent = "00:00";
        timer.style.display = "block";
      }
    }

  } catch (err) {
    console.error("Error loading QR:", err);
    qrExpiry = 0;

    if (timer) {
      timer.textContent = "Unable to load QR";
      timer.style.display = "block";
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

  // Immediately update the timer display
  const updateTimerDisplay = () => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = qrExpiry - now;

    // If no QR is loaded yet
    if (qrExpiry <= 0) {
      timer.textContent = "00:00";
      timer.style.display = "block";
      return false;
    }

    // If QR has expired
    if (remaining <= 0) {
      timer.textContent = "00:00";
      timer.style.display = "block";
      return true; // Signal to refresh
    }

    // Update timer display with remaining time
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    timer.style.display = "block";
    return false;
  };

  // Update immediately
  updateTimerDisplay();

  // Update every second
  window.qrIntervalId = setInterval(async () => {
    const shouldRefresh = updateTimerDisplay();

    if (shouldRefresh && !isLoadingQR && !qrRefreshStarted) {
      if (qrAwaitingManualRefresh) {
        timer.textContent = "Refresh needed";
        return;
      }

      qrRefreshStarted = true;
      timer.textContent = "Refreshing...";
      await loadQR("auto");
    }
  }, 1000);
}







async function initializeApp() {
  await fetchCompaniesAndBranches();
  populateCompanyOptions();

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

  await loadQR("manual");
  startGlobalTimer();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initializeApp();
  }, { once: true });
} else {
  void initializeApp();
}

/*for modals*/

function openModal(modal){
  modal.classList.add('show');
}

function closeModal(modal){
  const modalEl = typeof modal === 'string'
    ? document.getElementById(modal)
    : modal;

  if(modalEl){
    modalEl.classList.remove('show');
  }
}

const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
  loginBtn.addEventListener("click", () => {
    const modal = document.getElementById('loginModal');
    openModal(modal);
  });
}

window.addEventListener("click", e => {
  const modal = document.getElementById('loginModal');

  if(modal && e.target === modal){
    closeModal(modal);
  }
});

window.addEventListener("keydown", e => {
  const modal = document.getElementById('loginModal');

  if(modal && e.key === "Escape"){
    closeModal(modal);
  }
});

function initDashboardUI() {
  const accountNameLabel = document.getElementById("accountNameLabel");
  const logoutBtn = document.getElementById("logoutBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const mobileMenuToggle = document.getElementById("mobileMenuToggle");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".dashboard-section");
  const leaveModal = document.getElementById("leaveModal");
  const openLeaveModalBtn = document.getElementById("openLeaveModal");
  const leaveForm = document.getElementById("leaveForm");
  const leaveTableBody = document.getElementById("leaveTableBody");
  const scannerBtn = document.getElementById("scanQrBtn");
  const cameraBtn = document.getElementById("cameraScanBtn");
  const stopCameraBtn = document.getElementById("stopCameraBtn");
  const cameraPreview = document.getElementById("scannerCameraPreview");
  const leaveTypeField = document.getElementById("leaveType");
  const leaveStartDateField = document.getElementById("leaveStartDate");
  const leaveEndDateField = document.getElementById("leaveEndDate");
  const leaveReasonField = document.getElementById("leaveReason");
  const leaveModalTitle = leaveModal?.querySelector("h2");
  let editingLeaveId = null;
  const scannerStatus = document.getElementById("scannerStatus");
  const qrInput = document.getElementById("qrInput");
  let scannerStream = null;
  let scannerLoopId = null;
  let scannerDetector = null;

  const employeeData = localStorage.getItem("employee");
  const employee = employeeData ? JSON.parse(employeeData) : null;

  if (accountNameLabel) {
    const accountName = employee?.firstname
      ? `${employee.firstname} ${employee.surname || ""}`.trim()
      : localStorage.getItem("accountName") || localStorage.getItem("userId") || "AccountName";
    accountNameLabel.textContent = `Hi ${accountName}`;
  }

  const employeeID = document.getElementById("detailEmployeeID");
  const detailName = document.getElementById("detailName");
  const detailCompany = document.getElementById("detailCompany");
  const detailBranch = document.getElementById("detailBranch");
  const detailEmployeeId = document.getElementById("detailEmployeeId");
  const detailDateHired = document.getElementById("detailDateHired");
  const detailEmail = document.getElementById("detailEmail");
  const detailContact = document.getElementById("detailContact");
  const detailSchedule = document.getElementById("detailSchedule");
  const detailSSS = document.getElementById("detailSSS");
  const detailPhilHealth = document.getElementById("detailPhilHealth");
  const detailPagIbig = document.getElementById("detailPagIbig");
  const detailTIN = document.getElementById("detailTIN");
  const detailTax = document.getElementById("detailTax");
  const detailDepend = document.getElementById("detailDepend");
  const detailBank = document.getElementById("detailBank");
  const detailBankAccount = document.getElementById("detailBankAccount");

  if (employee) {
    if (employeeID) {
      employeeID.textContent = employee.employeeId || employeeID.textContent;
    }
    if (detailName) {
      const fullName = `${employee.firstname || ""} ${employee.middlename || ""} ${employee.surname || ""}`.replace(/\s+/g, " ").trim();
      detailName.textContent = fullName || detailName.textContent;
    }
    if (detailCompany) {
      detailCompany.textContent = employee.company || detailCompany.textContent;
    }
    if (detailBranch) {
      detailBranch.textContent = employee.branch || detailBranch.textContent;
    }
    if (detailEmployeeId) {
      detailEmployeeId.textContent = employee.employeeId || localStorage.getItem("employeeId") || detailEmployeeId.textContent;
    }
    if (detailDateHired) {
      const dateOnly = employee.dateHired ? employee.dateHired.split("T")[0] : detailDateHired.textContent;
      detailDateHired.textContent = dateOnly;
    }
    if (detailEmail) {
      detailEmail.textContent = employee.email || detailEmail.textContent;
    }
    if (detailContact) {
      detailContact.textContent = employee.contact || detailContact.textContent;
    }
    if (detailSchedule) {
      detailSchedule.textContent = employee.schedule || detailSchedule.textContent;
    }

    const govt = employee.govt || {};
    if (detailSSS) {
      detailSSS.textContent = govt.sss || detailSSS.textContent;
    }
    if (detailPhilHealth) {
      detailPhilHealth.textContent = govt.philH || detailPhilHealth.textContent;
    }
    if (detailPagIbig) {
      detailPagIbig.textContent = govt.pagIbig || detailPagIbig.textContent;
    }
    if (detailTIN) {
      detailTIN.textContent = govt.tin || detailTIN.textContent;
    }
    if (detailTax) {
      detailTax.textContent = govt.tax || detailTax.textContent;
    }
    if (detailDepend) {
      detailDepend.textContent = govt.depend || detailDepend.textContent;
    }
    if (detailBank) {
      detailBank.textContent = govt.bank || detailBank.textContent;
    }
    if (detailBankAccount) {
      detailBankAccount.textContent = govt.bAccount || detailBankAccount.textContent;
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("userId");
      window.location.href = "index.html";
    });
  }

  function setActiveSection(sectionId) {
    sections.forEach(section => {
      section.classList.toggle("active", section.id === sectionId);
    });

    navItems.forEach(item => {
      item.classList.toggle("active", item.dataset.section === sectionId);
    });

    if (window.innerWidth <= 760 && sidebar) {
      sidebar.classList.remove("open");
      sidebarOverlay?.classList.remove("show");
    }
  }

  navItems.forEach(item => {
    item.addEventListener("click", () => setActiveSection(item.dataset.section));
  });

  function toggleSidebar(forceOpen) {
    if (!sidebar) return;

    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", shouldOpen);
    sidebarOverlay?.classList.toggle("show", shouldOpen);
  }

  function stopCameraScan() {
    if (scannerLoopId) {
      clearInterval(scannerLoopId);
      scannerLoopId = null;
    }

    if (scannerStream) {
      scannerStream.getTracks().forEach(track => track.stop());
      scannerStream = null;
    }

    if (cameraPreview) {
      cameraPreview.srcObject = null;
      cameraPreview.hidden = true;
    }

    if (stopCameraBtn) {
      stopCameraBtn.hidden = true;
    }

    if (cameraBtn) {
      cameraBtn.disabled = false;
    }
  }

  async function startCameraScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      scannerStatus.textContent = "Camera scanning is not supported on this device. Please paste the QR code manually.";
      return;
    }

    if (!("BarcodeDetector" in window)) {
      scannerStatus.textContent = "This browser does not support built-in QR camera scanning. Please paste the QR code manually.";
      return;
    }

    try {
      scannerStatus.textContent = "Opening camera...";
      scannerDetector = new BarcodeDetector({ formats: ["qr_code"] });
      scannerStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });

      if (cameraPreview) {
        cameraPreview.srcObject = scannerStream;
        cameraPreview.hidden = false;
      }

      if (cameraBtn) {
        cameraBtn.disabled = true;
      }

      if (stopCameraBtn) {
        stopCameraBtn.hidden = false;
      }

      scannerStatus.textContent = "Scanning QR from camera...";

      scannerLoopId = setInterval(async () => {
        if (!scannerDetector || !cameraPreview || !cameraPreview.videoWidth) {
          return;
        }

        try {
          const detectedCodes = await scannerDetector.detect(cameraPreview);
          const detectedCode = detectedCodes?.[0]?.rawValue?.trim();

          if (!detectedCode) {
            return;
          }

          qrInput.value = detectedCode;
          scannerStatus.textContent = "QR scanned successfully. Verifying attendance...";
          stopCameraScan();
          await submitAttendanceVerification(detectedCode, scannerStatus);
        } catch (detectError) {
          console.warn("Unable to detect QR from camera stream:", detectError);
        }
      }, 900);
    } catch (error) {
      console.error("Unable to start camera scan:", error);
      scannerStatus.textContent = "Unable to access the camera. Please paste the QR code manually.";
      stopCameraScan();
    }
  }

  mobileMenuToggle?.addEventListener("click", () => toggleSidebar());
  sidebarToggle?.addEventListener("click", () => toggleSidebar());
  sidebarOverlay?.addEventListener("click", () => toggleSidebar(false));

  function resetLeaveForm() {
    leaveForm.reset();
    editingLeaveId = null;
    if (leaveModalTitle) {
      leaveModalTitle.textContent = "Apply Leave";
    }
  }

  document.querySelectorAll("[data-close-modal]").forEach(button => {
    button.addEventListener("click", () => {
      resetLeaveForm();
      closeModal(leaveModal);
    });
  });

  openLeaveModalBtn?.addEventListener("click", () => {
    resetLeaveForm();
    openModal(leaveModal);
  });

  leaveForm?.addEventListener("submit", event => {
    event.preventDefault();

    const leaveType = leaveTypeField?.value.trim();
    const startDate = leaveStartDateField?.value.trim();
    const endDate = leaveEndDateField?.value.trim();
    const leaveReason = leaveReasonField?.value.trim();

    if (!leaveType || !startDate || !endDate || !leaveReason) {
      return;
    }

    const statusMarkup = '<span class="status-tag info">Pending</span>';

    if (editingLeaveId) {
      const row = leaveTableBody?.querySelector(`button[data-id="${editingLeaveId}"]`)?.closest("tr");
      if (row) {
        row.children[0].textContent = leaveType;
        row.children[1].textContent = startDate;
        row.children[2].textContent = endDate;
        row.children[3].textContent = leaveReason;
        row.children[4].innerHTML = statusMarkup;
        row.children[5].innerHTML = `
          <div class="action-group">
            <button class="table-action-btn edit-btn" data-action="edit" data-id="${editingLeaveId}">Edit</button>
            <button class="table-action-btn cancel-btn" data-action="cancel" data-id="${editingLeaveId}">Cancel</button>
          </div>
        `;
      }
    } else {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${leaveType}</td>
        <td>${startDate}</td>
        <td>${endDate}</td>
        <td>${leaveReason}</td>
        <td>${statusMarkup}</td>
        <td>
          <div class="action-group">
            <button class="table-action-btn edit-btn" data-action="edit" data-id="new">Edit</button>
            <button class="table-action-btn cancel-btn" data-action="cancel" data-id="new">Cancel</button>
          </div>
        </td>
      `;
      leaveTableBody?.appendChild(row);
    }

    resetLeaveForm();
    closeModal(leaveModal);
  });

  leaveTableBody?.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const action = button.dataset.action;
    const row = button.closest("tr");
    const statusCell = row?.children[4];
    const statusText = statusCell?.textContent?.trim();

    if (action === "cancel") {
      if (statusText === "Used") {
        return;
      }

      const statusMarkup = statusText === "Approved"
        ? '<span class="status-tag danger">Cancelled</span>'
        : '<span class="status-tag danger">Cancelled</span>';

      if (row) {
        row.children[4].innerHTML = statusMarkup;
        row.children[5].innerHTML = '<span class="status-note">Cancelled</span>';
      }
      return;
    }

    if (action === "edit") {
      if (statusText === "Used" || statusText === "Cancelled") {
        return;
      }

      editingLeaveId = button.dataset.id;
      const leaveType = row?.children[0]?.textContent?.trim();
      const startDate = row?.children[1]?.textContent?.trim();
      const endDate = row?.children[2]?.textContent?.trim();
      const reason = row?.children[3]?.textContent?.trim();

      if (leaveTypeField) leaveTypeField.value = leaveType || "";
      if (leaveStartDateField) leaveStartDateField.value = startDate || "";
      if (leaveEndDateField) leaveEndDateField.value = endDate || "";
      if (leaveReasonField) leaveReasonField.value = reason || "";

      if (leaveModalTitle) {
        leaveModalTitle.textContent = "Edit Leave";
      }
      openModal(leaveModal);
    }
  });

  cameraBtn?.addEventListener("click", () => {
    void startCameraScan();
  });

  stopCameraBtn?.addEventListener("click", () => {
    stopCameraScan();
    scannerStatus.textContent = "Camera stopped. You can still paste the QR code manually.";
  });

  scannerBtn?.addEventListener("click", async () => {
    const value = qrInput?.value.trim();
    await submitAttendanceVerification(value, scannerStatus);
  });
}

if (document.querySelector(".dashboard-page")) {
  initDashboardUI();
}
