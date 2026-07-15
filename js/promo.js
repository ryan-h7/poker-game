/** Light growth tips: invite friends / share the site. */

const DISMISS_KEY = 'poker-promo-dismiss-until';
const TIP_INDEX_KEY = 'poker-promo-tip-index';
const DISMISS_MS = 3 * 24 * 60 * 60 * 1000;

const TIPS = [
  {
    id: 'invite',
    title: 'Play with friends',
    text: 'Start a private room and send them the link.',
    primary: { action: 'invite', label: 'Invite' },
    secondary: { action: 'share', label: 'Share' },
  },
  {
    id: 'share',
    title: 'Spread the word',
    text: 'Share Poker Games Club with someone new.',
    primary: { action: 'share', label: 'Share' },
    secondary: { action: 'copy', label: 'Copy link' },
  },
  {
    id: 'open',
    title: 'Find a table',
    text: 'Join an open table and play with real people.',
    primary: { action: 'open', label: 'Open tables' },
    secondary: { action: 'share', label: 'Share' },
  },
  {
    id: 'win',
    title: 'Nice win',
    text: 'Challenge a friend next — private rooms are free.',
    primary: { action: 'invite', label: 'Invite' },
    secondary: { action: 'share', label: 'Share' },
  },
];

let activeTip = null;
let lastGameOver = false;

export function getAppShareUrl() {
  return `${window.location.origin}/`;
}

export function getShareCopy() {
  return {
    title: 'Poker Games Club',
    text: 'Play free Texas Hold\'em online — solo vs bots or with friends:',
    url: getAppShareUrl(),
  };
}

export function isPromoDismissed() {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

export function dismissPromo() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
  } catch { /* ignore */ }
  activeTip = null;
}

function tipById(id) {
  return TIPS.find(t => t.id === id) || TIPS[0];
}

function rotateStoredIndex() {
  try {
    const prev = Number(localStorage.getItem(TIP_INDEX_KEY) || -1);
    let next = (Number.isFinite(prev) ? prev + 1 : 0) % TIPS.length;
    if (TIPS[next]?.id === 'win') next = (next + 1) % TIPS.length;
    localStorage.setItem(TIP_INDEX_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function getActivePromoTip({ gameOver = false } = {}) {
  if (gameOver && (!activeTip || activeTip.id !== 'win' || !lastGameOver)) {
    activeTip = tipById('win');
    lastGameOver = true;
    return activeTip;
  }
  if (!gameOver && lastGameOver) {
    lastGameOver = false;
    activeTip = null;
  }
  if (!activeTip) {
    activeTip = TIPS[rotateStoredIndex()] || TIPS[0];
  }
  return activeTip;
}

export function clearActivePromoTip() {
  activeTip = null;
}

export function shouldShowPromo(game) {
  if (!game || game.onlineMode || game.replaying) return false;
  if (isPromoDismissed()) return false;
  const betweenHands = game.phase === 'idle' || game.phase === 'showdown';
  if (!betweenHands) return false;
  if (game.isSoloGameOver()) return true;
  if (game.soloSessionActive) return true;
  return !game.lobbyPanelMode;
}
