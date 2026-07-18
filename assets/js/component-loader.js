// HTML Component Loader
const COMPONENTS_TO_LOAD = [
  { path: 'assets/html/header.html', elementId: 'headerContainer' },
  { path: 'assets/html/attendance-qr.html', elementId: 'qrContainer' },
  { path: 'assets/html/login-modal.html', elementId: 'modalContainer' }
];

function resolveTargetElement(targetElementId) {
  const requestedElement = document.getElementById(targetElementId);
  if (requestedElement) {
    return requestedElement;
  }

  if (targetElementId === 'qrContainer') {
    return document.getElementById('attendanceQR');
  }

  return null;
}

async function loadHtmlComponent(componentPath, targetElementId) {
  const targetElement = resolveTargetElement(targetElementId);
  if (!targetElement) {
    return;
  }

  try {
    const response = await fetch(new URL(componentPath, window.location.href));
    if (!response.ok) {
      throw new Error(`Failed to load component: ${componentPath}`);
    }

    const html = await response.text();
    targetElement.innerHTML = html;
  } catch (error) {
    console.error(`Error loading HTML component from ${componentPath}:`, error);
  }
}

async function loadAllComponents() {
  await Promise.all(
    COMPONENTS_TO_LOAD.map(({ path, elementId }) => loadHtmlComponent(path, elementId))
  );

  window.dispatchEvent(new Event('componentsLoaded'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void loadAllComponents();
  }, { once: true });
} else {
  void loadAllComponents();
}

