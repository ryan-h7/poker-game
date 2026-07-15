/** PWA registration + optional install prompt. */

const DISMISS_KEY = 'poker-pwa-install-dismiss';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

let deferredPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isDismissed() {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function dismissInstall() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
  } catch { /* ignore */ }
}

function isIosSafari() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit;
}

function getInstallUi() {
  return {
    bar: document.getElementById('pwa-install'),
    text: document.getElementById('pwa-install-text'),
    installBtn: document.getElementById('btn-pwa-install'),
    dismissBtn: document.getElementById('btn-pwa-dismiss'),
  };
}

function showInstallBar({ iosHint = false } = {}) {
  const { bar, text, installBtn } = getInstallUi();
  if (!bar || isStandalone() || isDismissed()) return;
  bar.classList.remove('hidden');
  if (iosHint) {
    if (text) {
      text.textContent = 'Install: tap Share, then “Add to Home Screen”.';
    }
    installBtn?.classList.add('hidden');
  } else {
    if (text) text.textContent = 'Install Poker Games Club on your home screen.';
    installBtn?.classList.remove('hidden');
  }
}

function hideInstallBar() {
  getInstallUi().bar?.classList.add('hidden');
}

export function initPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });
  }

  const { installBtn, dismissBtn } = getInstallUi();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBar();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBar();
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    hideInstallBar();
  });

  dismissBtn?.addEventListener('click', () => {
    dismissInstall();
    hideInstallBar();
  });

  // iOS has no beforeinstallprompt — show a gentle Share hint on mobile Safari
  if (!isStandalone() && !isDismissed() && isIosSafari()) {
    setTimeout(() => showInstallBar({ iosHint: true }), 2500);
  }
}
