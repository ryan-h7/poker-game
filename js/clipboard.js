/** Mobile / iOS-friendly clipboard helpers. */

export function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

export function canNativeShare() {
  return typeof navigator.share === 'function';
}

/**
 * Copy text — Clipboard API first, then hidden textarea + execCommand (iOS).
 * Works best when called directly from a click/tap handler.
 */
export async function copyToClipboard(text) {
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    /* fall through */
  }

  return false;
}

/** Native share sheet (mobile). Must run inside a user gesture. */
export async function shareLink(url, title = 'Join my poker game') {
  if (!canNativeShare()) return false;
  try {
    await navigator.share({ title, url });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false;
    return false;
  }
}

/**
 * Copy, or open share sheet on mobile if copy fails.
 * @returns {'copy'|'share'|'manual'}
 */
export async function copyOrShareLink(url, title = 'Join my poker game') {
  if (!url) return 'manual';

  if (await copyToClipboard(url)) return 'copy';

  if (isMobileDevice() && canNativeShare()) {
    if (await shareLink(url, title)) return 'share';
  }

  return 'manual';
}

/** Select invite input so user can long-press → Copy on iOS. */
export function primeLinkInput(inputEl, link) {
  if (!inputEl || !link) return;
  inputEl.value = link;
  inputEl.focus({ preventScroll: true });
  inputEl.select();
  try {
    inputEl.setSelectionRange(0, link.length);
  } catch {
    /* ignore */
  }
}
