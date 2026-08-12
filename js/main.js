import { PokerGame } from './game.js';
import {
  renderGame, setMessage, setRaiseAmount, getSelectedRaiseAmount,
  raiseDisplayToChips, syncRaiseInputFromChips, updateRaiseFromChips,
  showMultiplayerEntry, hideMultiplayerPanel,
  showJoinModal, hideJoinModal, setJoinModalError, renderTableDetails,
} from './ui.js';
import { NetworkClient, getRoomFromUrl, clearRoomFromUrl, normalizeRoomCode, loadRoomSession, clearRoomSession, saveSoloState, loadSoloState, clearSoloState } from './network.js';
import * as auth from './auth.js';
import {
  copyOrShareLink, shareLink, primeLinkInput, canNativeShare, isMobileDevice,
  copyToClipboard,
} from './clipboard.js';
import {
  dismissPromo, clearActivePromoTip, getShareCopy, getAppShareUrl,
} from './promo.js';
import { initPwa } from './pwa.js';
import { initI18n, setLanguage, getLanguage, t, applyDomTranslations } from './i18n.js';

const elements = {
  community: document.getElementById('community'),
  seats: document.getElementById('seats'),
  pot: document.getElementById('pot'),
  phase: document.getElementById('phase'),
  log: document.getElementById('log'),
  message: document.getElementById('message'),
  langBtn: document.getElementById('btn-lang'),
  langOptions: document.getElementById('lang-options'),
  langCurrent: document.getElementById('lang-current'),
  langMenu: document.getElementById('lang-menu'),
  promoSuggest: document.getElementById('promo-suggest'),
  promoSuggestTitle: document.getElementById('promo-suggest-title'),
  promoSuggestText: document.getElementById('promo-suggest-text'),
  promoPrimaryBtn: document.getElementById('btn-promo-primary'),
  promoSecondaryBtn: document.getElementById('btn-promo-secondary'),
  promoDismissBtn: document.getElementById('btn-promo-dismiss'),
  controls: document.getElementById('controls'),
  foldBtn: document.getElementById('btn-fold'),
  checkBtn: document.getElementById('btn-check'),
  callBtn: document.getElementById('btn-call'),
  raiseBtn: document.getElementById('btn-raise'),
  raiseSlider: document.getElementById('raise-slider'),
  raiseInput: document.getElementById('raise-input'),
  raiseInputLabel: document.getElementById('raise-input-label'),
  allInBtn: document.getElementById('btn-allin'),
  potPresets: document.getElementById('pot-presets'),
  raiseHint: document.getElementById('raise-hint'),
  newHandBtn: document.getElementById('btn-new-hand'),
  replayHandBtn: document.getElementById('btn-replay-hand'),
  saveStackBtn: document.getElementById('btn-save-stack'),
  resetSoloBtn: document.getElementById('btn-reset-solo'),
  resetSoloModal: document.getElementById('reset-solo-modal'),
  resetSoloConfirmBtn: document.getElementById('btn-reset-solo-confirm'),
  resetSoloCancelBtn: document.getElementById('btn-reset-solo-cancel'),
  openTablesBtn: document.getElementById('btn-open-tables'),
  privateRoomBtn: document.getElementById('btn-private-room'),
  publicTablesPanel: document.getElementById('public-tables-panel'),
  privateRoomPanel: document.getElementById('private-room-panel'),
  addBotBtn: document.getElementById('btn-add-bot'),
  removeBotBtn: document.getElementById('btn-remove-bot'),
  botCountLabel: document.getElementById('bot-count'),
  tableSizeHint: document.getElementById('table-size-hint'),
  startingStackSelect: document.getElementById('starting-stack'),
  bigBlindSelect: document.getElementById('big-blind'),
  anteSelect: document.getElementById('ante'),
  maxRebuysWrap: document.getElementById('max-rebuys-wrap'),
  maxRebuysSelect: document.getElementById('max-rebuys'),
  setupBar: document.getElementById('setup-bar'),
  skipBar: document.getElementById('skip-bar'),
  skipBtn: document.getElementById('btn-skip'),
  autoSkipCheckbox: document.getElementById('auto-skip'),
  showBotHandsCheckbox: document.getElementById('show-bot-hands'),
  displayModeBar: document.getElementById('display-mode'),
  displayDollarsBtn: document.getElementById('display-dollars'),
  displayBBBtn: document.getElementById('display-bb'),
  stopReplayBtn: document.getElementById('btn-stop-replay'),
  publicRoomsList: document.getElementById('public-rooms-list'),
  publicPlayerNameInput: document.getElementById('public-player-name'),
  lobbyEntry: document.getElementById('lobby-entry'),
  onlineToolbar: document.getElementById('online-toolbar'),
  rebuyBtn: document.getElementById('btn-rebuy'),
  tableDetailsPanel: document.getElementById('table-details-panel'),
  tableDetailsBtn: document.getElementById('btn-table-details'),
  closeTableDetailsBtn: document.getElementById('btn-close-table-details'),
  playerNameInput: document.getElementById('player-name'),
  joinRoomCodeInput: document.getElementById('join-room-code'),
  createRoomBtn: document.getElementById('btn-create-room'),
  joinRoomBtn: document.getElementById('btn-join-room'),
  copyLinkBtn: document.getElementById('btn-copy-link'),
  shareLinkBtn: document.getElementById('btn-share-link'),
  inviteLinkInput: document.getElementById('invite-link'),
  inviteRow: document.getElementById('invite-row'),
  lobbyRoomCode: document.getElementById('lobby-room-code'),
  lobbyPlayers: document.getElementById('lobby-players'),
  lobbyHint: document.getElementById('lobby-hint'),
  lobbyTableSettings: document.getElementById('lobby-table-settings'),
  leaveSessionBtn: document.getElementById('btn-leave-session'),
  joinModal: document.getElementById('join-modal'),
  joinModalTitle: document.getElementById('join-modal-title'),
  joinModalSub: document.getElementById('join-modal-sub'),
  joinModalRoomInput: document.getElementById('join-modal-room'),
  joinModalName: document.getElementById('join-modal-name'),
  joinModalError: document.getElementById('join-modal-error'),
  joinModalSubmit: document.getElementById('btn-join-modal-submit'),
  joinModalCancel: document.getElementById('btn-join-modal-cancel'),
  accountBar: document.getElementById('account-bar'),
  accountUser: document.getElementById('account-user'),
  accountBtn: document.getElementById('btn-account'),
  logoutBtn: document.getElementById('btn-logout'),
  authModal: document.getElementById('auth-modal'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authPasswordToggle: document.getElementById('btn-auth-password-toggle'),
  authConfirmPasswordWrap: document.getElementById('auth-confirm-password-wrap'),
  authPasswordConfirm: document.getElementById('auth-password-confirm'),
  authPasswordConfirmToggle: document.getElementById('btn-auth-password-confirm-toggle'),
  authDisplayName: document.getElementById('auth-display-name'),
  authDisplayNameLabel: document.querySelector('.auth-display-name-label'),
  authDisplayNameHint: document.getElementById('auth-display-name-hint'),
  authModalError: document.getElementById('auth-modal-error'),
  authModalSuccess: document.getElementById('auth-modal-success'),
  authTabLogin: document.getElementById('auth-tab-login'),
  authTabRegister: document.getElementById('auth-tab-register'),
  authSubmitBtn: document.getElementById('btn-auth-submit'),
  authCancelBtn: document.getElementById('btn-auth-cancel'),
  authForgotWrap: document.getElementById('auth-forgot-wrap'),
  authForgotBtn: document.getElementById('btn-auth-forgot'),
  authResetUnavailable: document.getElementById('auth-reset-unavailable'),
  authPasswordHint: document.getElementById('auth-password-hint'),
  authVerifyHint: document.getElementById('auth-verify-hint'),
  authSigninNameHint: document.getElementById('auth-signin-name-hint'),
  authResendWrap: document.getElementById('auth-resend-wrap'),
  authResendBtn: document.getElementById('btn-auth-resend'),
  accountModal: document.getElementById('account-modal'),
  accountEmail: document.getElementById('account-email'),
  accountDisplayName: document.getElementById('account-display-name'),
  accountModalError: document.getElementById('account-modal-error'),
  accountSaveBtn: document.getElementById('btn-account-save'),
  accountCancelBtn: document.getElementById('btn-account-cancel'),
  accountDeletePassword: document.getElementById('account-delete-password'),
  accountDeleteBtn: document.getElementById('btn-account-delete'),
  forgotModal: document.getElementById('forgot-modal'),
  forgotEmail: document.getElementById('forgot-email'),
  forgotModalError: document.getElementById('forgot-modal-error'),
  forgotModalSuccess: document.getElementById('forgot-modal-success'),
  forgotSubmitBtn: document.getElementById('btn-forgot-submit'),
  forgotCancelBtn: document.getElementById('btn-forgot-cancel'),
  resetModal: document.getElementById('reset-modal'),
  resetPassword: document.getElementById('reset-password'),
  resetModalError: document.getElementById('reset-modal-error'),
  resetModalSuccess: document.getElementById('reset-modal-success'),
  resetSubmitBtn: document.getElementById('btn-reset-submit'),
  resetCancelBtn: document.getElementById('btn-reset-cancel'),
  statsPanel: document.getElementById('stats-panel'),
  statHands: document.getElementById('stat-hands'),
  statWinPct: document.getElementById('stat-win-pct'),
  statProfit: document.getElementById('stat-profit'),
  statVpip: document.getElementById('stat-vpip'),
  statPfr: document.getElementById('stat-pfr'),
  statWtsd: document.getElementById('stat-wtsd'),
  statWsd: document.getElementById('stat-wsd'),
};

let autoSkipWhenFolded = false;
let showBotHandsAtEnd = false;
let showInBB = false;
let inOnlineRoom = false;
let pendingInviteRoomId = null;
let soloSaveTimer;
let authTab = 'login';
let accountsEnabled = false;
let passwordResetEnabled = false;
let emailVerificationEnabled = false;
let pendingResetToken = null;
let pendingVerifyEmail = '';
let publicRoomsPollTimer = null;
let cachedPublicRooms = [];

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function formatPublicRoomStatus(room) {
  if (room.inHand) return 'Hand in progress';
  if (room.tableStatus === 'between_hands') return 'Between hands';
  return 'Waiting for players';
}

function renderPublicRooms(rooms) {
  cachedPublicRooms = rooms || [];
  const el = elements.publicRoomsList;
  if (!el) return;
  if (!cachedPublicRooms.length) {
    el.innerHTML = `<p class="public-rooms-sub">${t('lobby.noTables')}</p>`;
    return;
  }
  const inRoom = inOnlineRoom && game.onlineMode;
  el.innerHTML = cachedPublicRooms.map((room) => {
    const seated = room.seated ?? room.players ?? 0;
    const full = seated >= room.maxPlayers;
    const statusClass = room.inHand ? 'in-hand' : '';
    const disabled = full || inRoom;
    const label = full
      ? t('lobby.full')
      : (inRoom ? t('lobby.join') : t('lobby.join'));
    // Keep seated state distinct in English UI via existing disabled button; label still Join/Full.
    const tableType = room.allowBots === false ? 'Humans only' : 'With bots';
    return `<div class="public-room-card ${full ? 'is-full' : ''}" role="listitem">
      <div class="public-room-card-header">
        <span class="public-room-name">${escapeHtml(room.name)}</span>
        <span class="public-room-count">${seated}/${room.maxPlayers}</span>
      </div>
      <div class="public-room-meta">$${room.bigBlind} BB · $${Number(room.startingStack).toLocaleString()} stacks · ${tableType}</div>
      <div class="public-room-status ${statusClass}">${formatPublicRoomStatus(room)}</div>
      <button type="button" class="btn-join-public" data-room-id="${escapeHtml(room.id)}" ${disabled ? 'disabled' : ''}>${label}</button>
    </div>`;
  }).join('');
}

async function refreshPublicRooms() {
  try {
    if (!network.connected) await network.connect();
    const rooms = await network.fetchPublicRooms();
    renderPublicRooms(rooms);
  } catch {
    if (!cachedPublicRooms.length) renderPublicRooms([]);
  }
}

function startPublicRoomsPolling() {
  clearInterval(publicRoomsPollTimer);
  refreshPublicRooms();
  publicRoomsPollTimer = setInterval(refreshPublicRooms, 5000);
}

function stopPublicRoomsPolling() {
  clearInterval(publicRoomsPollTimer);
  publicRoomsPollTimer = null;
}

async function joinPublicRoom(roomId) {
  if (!roomId || (inOnlineRoom && game.onlineMode)) return;
  const name = getPlayerName();
  if (!name || name === 'Player') {
    setMessage(elements.message, t('msg.enterName'));
    elements.publicPlayerNameInput?.focus();
    return;
  }
  clearSoloState();
  game.soloSessionActive = false;
  try {
    await network.joinRoom(roomId, name);
    stopPublicRoomsPolling();
    game.lobbyPanelMode = null;
    hideMultiplayerPanel(elements);
  } catch (err) {
    setMessage(elements.message, err.message || 'Could not join table.');
    refreshPublicRooms();
  }
}

function setModalMessage(el, message, isSuccess = false) {
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
  el.classList.toggle('join-modal-success', isSuccess);
  el.classList.toggle('join-modal-error', !isSuccess);
}

async function persistSoloState(state) {
  saveSoloState(state);
  if (auth.isLoggedIn()) {
    await auth.saveSoloGame(state);
  }
}

function scheduleSoloSave() {
  if (game.onlineMode || game.replaying) return;
  clearTimeout(soloSaveTimer);
  soloSaveTimer = setTimeout(async () => {
    if (game.onlineMode || game.replaying) return;
    if (!game.soloSessionActive) {
      clearSoloState();
      if (auth.isLoggedIn()) auth.clearSoloGame();
      return;
    }
    const state = game.exportSoloState();
    if (state) await persistSoloState(state);
  }, 250);
}

async function recordHandStats(handStats) {
  if (!auth.isLoggedIn() || game.onlineMode) return;
  await auth.recordHand(handStats);
  await refreshStatsDisplay();
}

async function refreshStatsDisplay() {
  if (!auth.isLoggedIn() || !accountsEnabled) return;
  const raw = await auth.fetchStats();
  const stats = auth.formatStats(raw);
  if (!stats) return;
  if (elements.statHands) elements.statHands.textContent = String(stats.hands);
  if (elements.statWinPct) elements.statWinPct.textContent = `${stats.winPct}%`;
  if (elements.statProfit) {
    elements.statProfit.textContent = stats.profitLabel;
    elements.statProfit.classList.toggle('positive', stats.profit > 0);
    elements.statProfit.classList.toggle('negative', stats.profit < 0);
  }
  if (elements.statVpip) elements.statVpip.textContent = `${stats.vpipPct}%`;
  if (elements.statPfr) elements.statPfr.textContent = `${stats.pfrPct}%`;
  if (elements.statWtsd) elements.statWtsd.textContent = `${stats.wtsdPct}%`;
  if (elements.statWsd) elements.statWsd.textContent = `${stats.wsdPct}%`;
}

function updateAccountUI() {
  if (!accountsEnabled) {
    elements.accountBar?.classList.add('hidden');
    return;
  }
  elements.accountBar?.classList.remove('hidden');
  const user = auth.getUser();
  if (auth.isLoggedIn() && user) {
    elements.accountUser?.classList.remove('hidden');
    if (elements.accountUser) elements.accountUser.textContent = user.displayName;
    elements.accountBtn?.classList.add('hidden');
    elements.logoutBtn?.classList.remove('hidden');
  } else {
    elements.accountUser?.classList.add('hidden');
    elements.accountBtn?.classList.remove('hidden');
    elements.logoutBtn?.classList.add('hidden');
  }
}

function setAuthModalError(message) {
  if (!elements.authModalError) return;
  elements.authModalError.textContent = message || '';
  elements.authModalError.classList.toggle('hidden', !message);
}

function setAuthModalSuccess(message) {
  if (!elements.authModalSuccess) return;
  elements.authModalSuccess.textContent = message || '';
  elements.authModalSuccess.classList.toggle('hidden', !message);
}

function setAuthResendVisible(visible) {
  elements.authResendWrap?.classList.toggle('hidden', !visible);
}

function setPasswordFieldVisible(input, toggleBtn, visible) {
  if (!input) return;
  input.type = visible ? 'text' : 'password';
  if (toggleBtn) {
    toggleBtn.textContent = visible ? t('auth.hide') : t('auth.show');
    toggleBtn.setAttribute('aria-label', visible ? t('auth.hide') : t('auth.show'));
  }
}

function resetPasswordFieldVisibility() {
  setPasswordFieldVisible(elements.authPassword, elements.authPasswordToggle, false);
  setPasswordFieldVisible(elements.authPasswordConfirm, elements.authPasswordConfirmToggle, false);
}

function bindPasswordToggle(input, toggleBtn) {
  toggleBtn?.addEventListener('click', () => {
    if (!input) return;
    setPasswordFieldVisible(input, toggleBtn, input.type === 'password');
  });
}

function updateAuthResetUI() {
  const isRegister = authTab === 'register';
  const showForgot = !isRegister && passwordResetEnabled;
  const showUnavailable = !isRegister && accountsEnabled && !passwordResetEnabled;
  elements.authForgotBtn?.classList.toggle('hidden', !showForgot);
  elements.authResetUnavailable?.classList.toggle('hidden', !showUnavailable);
  elements.authForgotWrap?.classList.toggle('hidden', isRegister);
  elements.authPasswordHint?.classList.toggle('hidden', !isRegister || !accountsEnabled);
  elements.authVerifyHint?.classList.toggle('hidden', !isRegister || !emailVerificationEnabled);
  elements.authSigninNameHint?.classList.toggle('hidden', isRegister || !accountsEnabled);
  if (isRegister) setAuthResendVisible(false);
}

function setAuthTab(tab) {
  authTab = tab;
  const isRegister = tab === 'register';
  elements.authTabLogin?.classList.toggle('active', !isRegister);
  elements.authTabRegister?.classList.toggle('active', isRegister);
  elements.authDisplayName?.classList.toggle('hidden', !isRegister);
  elements.authDisplayNameLabel?.classList.toggle('hidden', !isRegister);
  elements.authDisplayNameHint?.classList.toggle('hidden', !isRegister);
  elements.authConfirmPasswordWrap?.classList.toggle('hidden', !isRegister);
  if (!isRegister && elements.authPasswordConfirm) elements.authPasswordConfirm.value = '';
  setAuthModalError('');
  if (isRegister) {
    setAuthModalSuccess('');
    setAuthResendVisible(false);
  }
  if (elements.authSubmitBtn) {
    elements.authSubmitBtn.textContent = isRegister ? t('account.create') : t('account.signIn');
  }
  if (elements.authModal?.querySelector('#auth-modal-title')) {
    elements.authModal.querySelector('#auth-modal-title').textContent = isRegister
      ? t('account.create')
      : t('account.signIn');
  }
  elements.authPassword?.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  elements.authPasswordConfirm?.setAttribute('autocomplete', 'off');
  updateAuthResetUI();
  setAuthModalError('');
}

function showAccountModal() {
  const user = auth.getUser();
  if (!user) return;
  if (elements.accountEmail) elements.accountEmail.value = user.email;
  if (elements.accountDisplayName) {
    elements.accountDisplayName.value = user.displayName || '';
    elements.accountDisplayName.focus();
    elements.accountDisplayName.select();
  }
  setModalMessage(elements.accountModalError, '');
  if (elements.accountDeletePassword) elements.accountDeletePassword.value = '';
  elements.accountModal?.classList.remove('hidden');
  refreshStatsDisplay();
}

function hideAccountModal() {
  elements.accountModal?.classList.add('hidden');
  setModalMessage(elements.accountModalError, '');
  if (elements.accountDeletePassword) elements.accountDeletePassword.value = '';
}

async function handleAccountSave() {
  const displayName = elements.accountDisplayName?.value?.trim();
  if (!displayName) {
    setModalMessage(elements.accountModalError, 'Enter a display name.');
    return;
  }
  elements.accountSaveBtn.disabled = true;
  try {
    const result = await auth.updateDisplayName(displayName);
    if (!result.ok) {
      setModalMessage(elements.accountModalError, result.error || 'Could not update name.');
      return;
    }
    const name = result.user.displayName;
    syncPlayerNameInputs(name);
    hideAccountModal();
    updateAccountUI();
    setMessage(elements.message, `Display name updated to ${name}.`);
    renderGame(game, elements);
  } finally {
    elements.accountSaveBtn.disabled = false;
  }
}

async function handleAccountDelete() {
  const password = elements.accountDeletePassword?.value || '';
  if (!password) {
    setModalMessage(elements.accountModalError, 'Enter your password to delete your account.');
    return;
  }
  if (!window.confirm('Delete your account permanently? Your stats and saved games will be removed and this cannot be undone.')) {
    return;
  }

  elements.accountDeleteBtn.disabled = true;
  try {
    const result = await auth.deleteAccount(password);
    if (!result.ok) {
      setModalMessage(elements.accountModalError, result.error || 'Could not delete account.');
      return;
    }
    clearSoloState();
    game.soloSessionActive = false;
    hideAccountModal();
    updateAccountUI();
    setMessage(elements.message, 'Your account has been deleted.');
    renderGame(game, elements);
  } finally {
    elements.accountDeleteBtn.disabled = false;
  }
}

function showForgotModal(prefillEmail = '') {
  hideAuthModal();
  if (elements.forgotEmail) {
    elements.forgotEmail.value = prefillEmail;
    elements.forgotEmail.focus();
  }
  setModalMessage(elements.forgotModalError, '');
  setModalMessage(elements.forgotModalSuccess, '', true);
  elements.forgotSubmitBtn.disabled = false;
  elements.forgotModal?.classList.remove('hidden');
}

function hideForgotModal() {
  elements.forgotModal?.classList.add('hidden');
  setModalMessage(elements.forgotModalError, '');
  setModalMessage(elements.forgotModalSuccess, '', true);
}

async function handleForgotSubmit() {
  const email = elements.forgotEmail?.value?.trim();
  if (!email) {
    setModalMessage(elements.forgotModalError, 'Enter your email address.');
    return;
  }
  elements.forgotSubmitBtn.disabled = true;
  setModalMessage(elements.forgotModalError, '');
  setModalMessage(elements.forgotModalSuccess, '', true);
  try {
    const result = await auth.requestPasswordReset(email);
    if (!result.ok) {
      setModalMessage(elements.forgotModalError, result.error || 'Could not send reset email.');
      elements.forgotSubmitBtn.disabled = false;
      return;
    }
    setModalMessage(
      elements.forgotModalSuccess,
      result.message || 'If an account exists for that email, a reset link has been sent.',
      true,
    );
  } catch {
    setModalMessage(elements.forgotModalError, 'Could not send reset email. Try again later.');
    elements.forgotSubmitBtn.disabled = false;
  }
}

function showResetPasswordModal(token) {
  pendingResetToken = token;
  if (elements.resetPassword) elements.resetPassword.value = '';
  setModalMessage(elements.resetModalError, '');
  setModalMessage(elements.resetModalSuccess, '', true);
  elements.resetSubmitBtn.disabled = false;
  elements.resetModal?.classList.remove('hidden');
  elements.resetPassword?.focus();
}

function hideResetPasswordModal() {
  pendingResetToken = null;
  elements.resetModal?.classList.add('hidden');
  setModalMessage(elements.resetModalError, '');
  setModalMessage(elements.resetModalSuccess, '', true);
}

async function handleResetSubmit() {
  const password = elements.resetPassword?.value || '';
  if (!pendingResetToken) {
    setModalMessage(elements.resetModalError, 'This reset link is invalid.');
    return;
  }
  if (password.length < 8) {
    setModalMessage(elements.resetModalError, 'Password must be at least 8 characters.');
    return;
  }
  elements.resetSubmitBtn.disabled = true;
  setModalMessage(elements.resetModalError, '');
  setModalMessage(elements.resetModalSuccess, '', true);
  try {
    const result = await auth.resetPassword(pendingResetToken, password);
    if (!result.ok) {
      setModalMessage(elements.resetModalError, result.error || 'Could not reset password.');
      elements.resetSubmitBtn.disabled = false;
      return;
    }
    hideResetPasswordModal();
    showAuthModal('login');
    setMessage(elements.message, result.message || 'Password updated. You can sign in now.');
  } catch {
    setModalMessage(elements.resetModalError, 'Could not reset password. Try again later.');
    elements.resetSubmitBtn.disabled = false;
  }
}

function consumeResetTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('reset');
  if (!token) return null;
  url.searchParams.delete('reset');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', next);
  return token;
}

function showAuthModal(tab = 'login') {
  setAuthTab(tab);
  setAuthModalError('');
  setAuthModalSuccess('');
  setAuthResendVisible(false);
  elements.authModal?.classList.remove('hidden');
  elements.authEmail?.focus();
}

function hideAuthModal() {
  elements.authModal?.classList.add('hidden');
  setAuthModalError('');
  setAuthModalSuccess('');
  setAuthResendVisible(false);
  resetPasswordFieldVisibility();
  if (elements.authPasswordConfirm) elements.authPasswordConfirm.value = '';
}

async function handleAuthSubmit() {
  const email = elements.authEmail?.value?.trim();
  const password = elements.authPassword?.value || '';
  const displayName = elements.authDisplayName?.value?.trim();
  if (!email || !password) {
    setAuthModalError('Enter your email and password.');
    return;
  }
  if (authTab === 'register') {
    const confirmPassword = elements.authPasswordConfirm?.value || '';
    if (!confirmPassword) {
      setAuthModalError('Confirm your password.');
      return;
    }
    if (password !== confirmPassword) {
      setAuthModalError('Passwords do not match.');
      return;
    }
  }
  elements.authSubmitBtn.disabled = true;
  setAuthModalError('');
  setAuthModalSuccess('');
  setAuthResendVisible(false);
  try {
    const result = authTab === 'register'
      ? await auth.register({ email, password, displayName })
      : await auth.login({ email, password });

    if (result.needsVerification) {
      pendingVerifyEmail = result.email || email;
      setAuthModalError(result.error || '');
      setAuthModalSuccess(result.message
        || 'Check your email for a verification link before signing in.');
      setAuthResendVisible(emailVerificationEnabled);
      if (authTab === 'register') setAuthTab('login');
      return;
    }

    if (!result.ok) {
      setAuthModalError(result.error || (authTab === 'register'
        ? 'Could not create account.'
        : 'Could not sign in.'));
      return;
    }

    const name = result.user.displayName;
    syncPlayerNameInputs(name);
    hideAuthModal();
    updateAccountUI();
    if (!passwordResetEnabled && authTab === 'register') {
      setMessage(elements.message, `Welcome, ${name}! Save your password — reset isn't available if you forget it.`);
    } else {
      if (!game.soloSessionActive && !game.onlineMode) {
        const restored = await tryRestoreSoloSession();
        if (restored) return;
      }
      setMessage(elements.message, t('msg.signedIn', { name }));
    }
    renderGame(game, elements);
  } catch (err) {
    setAuthModalError(err?.message || (authTab === 'register'
      ? 'Could not create account.'
      : 'Could not sign in.'));
  } finally {
    elements.authSubmitBtn.disabled = false;
  }
}

async function handleResendVerification() {
  const email = pendingVerifyEmail || elements.authEmail?.value?.trim();
  if (!email) {
    setAuthModalError('Enter the email you used to register.');
    return;
  }
  elements.authResendBtn.disabled = true;
  setAuthModalError('');
  try {
    const result = await auth.resendVerification(email);
    if (!result.ok) {
      setAuthModalError(result.error || 'Could not resend verification email.');
      return;
    }
    setAuthModalSuccess(result.message || 'If that account needs verification, a new link has been sent.');
  } catch {
    setAuthModalError('Could not resend verification email. Try again later.');
  } finally {
    elements.authResendBtn.disabled = false;
  }
}

function consumeVerifyTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('verify');
  if (!token) return null;
  url.searchParams.delete('verify');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', next);
  return token;
}

async function handleEmailVerificationFromUrl(token) {
  try {
    const result = await auth.verifyEmail(token);
    if (!result.ok) {
      showAuthModal('login');
      setAuthModalError(result.error || 'This verification link is invalid or has expired.');
      setAuthResendVisible(emailVerificationEnabled);
      return;
    }
    const name = result.user?.displayName || 'Player';
    syncPlayerNameInputs(name);
    updateAccountUI();
    setMessage(elements.message, result.message || `Email verified. Signed in as ${name}.`);
    renderGame(game, elements);
  } catch {
    showAuthModal('login');
    setAuthModalError('Could not verify email. Try again or request a new link.');
  }
}

function syncSoloUIFromGame() {
  if (elements.startingStackSelect) {
    elements.startingStackSelect.value = String(game.startingStack);
  }
  if (elements.bigBlindSelect) {
    elements.bigBlindSelect.value = String(game.bigBlind);
  }
  if (elements.anteSelect) {
    elements.anteSelect.value = String(game.anteFraction ?? 0);
  }
}

try {
  autoSkipWhenFolded = localStorage.getItem('poker-auto-skip') === '1';
  if (elements.autoSkipCheckbox) elements.autoSkipCheckbox.checked = autoSkipWhenFolded;
  showBotHandsAtEnd = localStorage.getItem('poker-show-bot-hands') === '1';
  if (elements.showBotHandsCheckbox) elements.showBotHandsCheckbox.checked = showBotHandsAtEnd;
  showInBB = localStorage.getItem('poker-show-in-bb') === '1';
  const savedName = localStorage.getItem('poker-player-name');
  if (savedName) syncPlayerNameInputs(savedName);
} catch { /* ignore */ }

const game = new PokerGame(
  () => {
    renderGame(game, elements);
    scheduleSoloSave();
  },
  (msg) => setMessage(elements.message, msg),
  (handStats) => { recordHandStats(handStats); },
);
game.setShowBotHandsAtEnd(showBotHandsAtEnd);
game.setShowInBB(showInBB);

const network = new NetworkClient({
  onPublicRooms: (rooms) => renderPublicRooms(rooms),
  onLobby: (lobby) => {
    inOnlineRoom = true;
    game.onlineMode = true;
    game.roomStatus = lobby.status || 'lobby';
    game.lobbyPanelMode = null;
    game.isHost = lobby.isHost;
    const me = lobby.members.find(m => m.id === network.socket?.id);
    if (me) {
      game.localSeatIndex = me.seatIndex;
      network.seatIndex = me.seatIndex;
    }
    game.localSocketId = network.socket?.id ?? null;
    game.playerCount = lobby.settings.playerCount;
    game.bigBlind = lobby.settings.bigBlind;
    game.startingStack = lobby.settings.startingStack ?? 1000;
    game.maxRebuys = lobby.settings.maxRebuys ?? 3;
    game.anteFraction = lobby.settings.anteFraction ?? 0;
    if (lobby.settings.showBotHandsAtEnd !== undefined) {
      showBotHandsAtEnd = !!lobby.settings.showBotHandsAtEnd;
      game.showBotHandsAtEnd = showBotHandsAtEnd;
    } else if (lobby.isPublic) {
      showBotHandsAtEnd = false;
      game.showBotHandsAtEnd = false;
    }
    game.isPublicRoom = !!lobby.isPublic;
    game.allowBots = lobby.allowBots !== false;
    game.roomDisplayName = lobby.displayName || lobby.roomId;
    game.roomId = lobby.roomId;
    game.inviteLink = lobby.inviteLink || game.inviteLink;
    game.setOnlinePlayers(lobby.members, lobby.settings.playerCount, true);
    if (lobby.tableHudStats) game.tableHudStats = lobby.tableHudStats;
    hideJoinModal(elements);
    renderTableDetails(elements, {
      roomId: lobby.roomId,
      isHost: lobby.isHost,
      localSocketId: network.socket?.id,
      inviteLink: lobby.inviteLink,
      members: lobby.members,
      settings: lobby.settings,
      isPublic: !!lobby.isPublic,
      allowBots: lobby.allowBots !== false,
      displayName: lobby.displayName || lobby.roomId,
      status: lobby.status,
    });
    if (lobby.message) {
      setMessage(elements.message, lobby.message);
    } else if (game.roomStatus === 'lobby') {
      const humans = lobby.members?.length ?? 0;
      if (lobby.isPublic) {
        setMessage(elements.message, lobby.isHost
          ? (lobby.allowBots === false
            ? 'Humans-only table — deal when at least 2 players are seated.'
            : 'You\'re at the table — deal when ready. Bots fill empty seats.')
          : (lobby.allowBots === false
            ? 'Humans-only table — waiting for more players or a deal.'
            : 'You\'re at the table — waiting for someone to deal.'));
      } else {
        setMessage(elements.message, lobby.isHost
          ? (humans < 2
            ? 'Share the invite link. Deal when ready — bots fill empty seats.'
            : 'Share the invite link. Deal when everyone has joined.')
          : 'You\'re in the lobby — waiting for the host to deal.');
      }
    }
    renderGame(game, elements);
  },
  onGameState: (state) => {
    inOnlineRoom = true;
    hideJoinModal(elements);
    game.applyNetworkState(state);
    game.isHost = state.isHost;
    game.localSeatIndex = state.localSeatIndex;
    game.localSocketId = network.socket?.id ?? null;
    game.roomStatus = state.status || 'active';
    game.lobbyPanelMode = null;
    if (state.inviteLink) game.inviteLink = state.inviteLink;
    if (state.message) setMessage(elements.message, state.message);
    if (state.showBotHandsAtEnd !== undefined) {
      showBotHandsAtEnd = !!state.showBotHandsAtEnd;
    }
    renderGame(game, elements);
  },
  onKicked: (reason) => {
    clearSoloState();
    game.soloSessionActive = false;
    inOnlineRoom = false;
    game.onlineMode = false;
    game.isHost = false;
    game.isPublicRoom = false;
    game.allowBots = true;
    game.roomDisplayName = '';
    game.lobbyPanelMode = null;
    game.roomStatus = 'lobby';
    game.tableDetailsOpen = false;
    game.inviteLink = '';
    game.phase = 'idle';
    game.resetPlayers();
    hideMultiplayerPanel(elements);
    hideJoinModal(elements);
    clearRoomFromUrl();
    setMessage(elements.message, reason);
    renderGame(game, elements);
  },
});

function syncPlayerNameInputs(name) {
  if (elements.playerNameInput) elements.playerNameInput.value = name;
  if (elements.publicPlayerNameInput) elements.publicPlayerNameInput.value = name;
  if (elements.joinModalName) elements.joinModalName.value = name;
}

function getPlayerName(fromModal = false) {
  let raw;
  if (fromModal) {
    raw = elements.joinModalName?.value;
  } else if (game.lobbyPanelMode === 'public') {
    raw = elements.publicPlayerNameInput?.value;
  } else {
    raw = elements.playerNameInput?.value;
  }
  const name = String(raw || 'Player').trim() || 'Player';
  try { localStorage.setItem('poker-player-name', name); } catch { /* ignore */ }
  syncPlayerNameInputs(name);
  return name.slice(0, 16);
}

function getTableSettings() {
  return {
    playerCount: game.playerCount,
    bigBlind: parseInt(elements.bigBlindSelect.value, 10),
    startingStack: parseInt(elements.startingStackSelect.value, 10),
    maxRebuys: parseInt(elements.maxRebuysSelect?.value ?? '3', 10),
    anteFraction: Number(elements.anteSelect?.value ?? 0),
    showBotHandsAtEnd: !!game.showBotHandsAtEnd,
  };
}

async function pushTableSettings(patch = {}) {
  const settings = { ...getTableSettings(), ...patch };
  if (isOnline() && game.isHost) {
    const res = await network.updateSettings(settings);
    if (!res.ok) {
      setMessage(elements.message, res.error || 'Could not update table settings.');
      return false;
    }
    return true;
  }
  if (patch.playerCount !== undefined) game.setPlayerCount(settings.playerCount);
  else if (patch.startingStack !== undefined) game.setStartingStack(settings.startingStack);
  else if (patch.bigBlind !== undefined) game.setBigBlind(settings.bigBlind);
  else if (patch.maxRebuys !== undefined) game.maxRebuys = settings.maxRebuys;
  else if (patch.anteFraction !== undefined) game.anteFraction = settings.anteFraction;
  return true;
}

function isOnline() {
  return inOnlineRoom && game.onlineMode;
}

async function copyInviteLink(link) {
  if (!link) return 'manual';
  primeLinkInput(elements.inviteLinkInput, link);
  return copyOrShareLink(link);
}

function inviteLinkMessage(result, { created = false } = {}) {
  const prefix = created ? 'Room created! ' : '';
  if (result === 'copy') return `${prefix}Invite link copied to clipboard.`;
  if (result === 'share') return `${prefix}Share the invite link from the sheet.`;
  if (isMobileDevice()) {
    return `${prefix}Tap the link below to select it, then Copy — or use Share.`;
  }
  return `${prefix}Copy the invite link from Table details.`;
}

async function joinRoom(roomId, fromModal = false) {
  const code = normalizeRoomCode(roomId);
  if (!code) {
    if (fromModal) setJoinModalError(elements, 'Enter a room code.');
    else setMessage(elements.message, 'Enter a room code to join.');
    return;
  }
  clearSoloState();
  const btn = fromModal ? elements.joinModalSubmit : elements.joinRoomBtn;
  if (btn) btn.disabled = true;
  if (fromModal) setJoinModalError(elements, '');
  try {
    await network.joinRoom(code, getPlayerName(fromModal));
    stopPublicRoomsPolling();
    pendingInviteRoomId = null;
    if (elements.joinRoomCodeInput) elements.joinRoomCodeInput.value = code;
  } catch (err) {
    const msg = err.message || 'Could not join room.';
    if (fromModal) setJoinModalError(elements, msg);
    else setMessage(elements.message, msg);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function joinInviteRoom(roomId) {
  await joinRoom(roomId, true);
}

async function sendAction(action, amount = 0) {
  if (!isOnline()) {
    game.humanAction(action, amount);
    return;
  }
  const res = await network.sendAction(action, amount);
  if (!res.ok) setMessage(elements.message, res.error || 'Action failed.');
}

function submitRaise(allIn = false) {
  const player = game.players[game.activeIndex];
  if (!player) return;
  if (allIn) {
    sendAction('allin');
    return;
  }
  const amount = getSelectedRaiseAmount(game, elements);
  if (amount >= player.bet + player.chips) sendAction('allin');
  else sendAction('raise', amount);
}

elements.newHandBtn.addEventListener('click', async () => {
  if (isOnline()) {
    const res = await network.startHand();
    if (!res.ok) setMessage(elements.message, res.error || 'Could not start hand.');
    return;
  }
  game.startNewHand();
});

elements.replayHandBtn.addEventListener('click', () => game.replayHand());
elements.stopReplayBtn.addEventListener('click', () => game.stopReplay());

elements.saveStackBtn?.addEventListener('click', () => {
  if (game.onlineMode || !game.isSoloGameOver()) return;
  game.saveStackAndRefill();
});

function showResetSoloModal() {
  if (game.onlineMode || !game.soloSessionActive) return;
  elements.resetSoloModal?.classList.remove('hidden');
}

function hideResetSoloModal() {
  elements.resetSoloModal?.classList.add('hidden');
}

function performSoloReset() {
  game.resetSoloSession();
  clearSoloState();
  if (auth.isLoggedIn()) auth.clearSoloGame();
  hideResetSoloModal();
  setMessage(elements.message, t('msg.gameReset'));
  renderGame(game, elements);
  elements.setupBar?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

elements.resetSoloBtn?.addEventListener('click', () => {
  showResetSoloModal();
});
elements.resetSoloConfirmBtn?.addEventListener('click', () => {
  if (game.onlineMode || !game.soloSessionActive) return;
  performSoloReset();
});
elements.resetSoloCancelBtn?.addEventListener('click', () => hideResetSoloModal());
elements.resetSoloModal?.addEventListener('click', (e) => {
  if (e.target === elements.resetSoloModal) hideResetSoloModal();
});

function openLobbyPanel(mode) {
  const nextMode = game.lobbyPanelMode === mode ? null : mode;
  game.lobbyPanelMode = nextMode;
  if (nextMode === 'public') {
    showMultiplayerEntry(elements, 'public');
    startPublicRoomsPolling();
    setMessage(elements.message, t('msg.pickOpen'));
    elements.publicTablesPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (nextMode === 'private') {
    stopPublicRoomsPolling();
    showMultiplayerEntry(elements, 'private');
    setMessage(elements.message, t('msg.privateHint'));
    elements.privateRoomPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    stopPublicRoomsPolling();
    hideMultiplayerPanel(elements);
    setMessage(elements.message, t('msg.dealPrompt'));
  }
  renderGame(game, elements);
}

elements.openTablesBtn?.addEventListener('click', () => openLobbyPanel('public'));
elements.privateRoomBtn?.addEventListener('click', () => openLobbyPanel('private'));

async function handlePromoAction(action) {
  if (!action) return;
  if (action === 'invite') {
    dismissPromo();
    openLobbyPanel('private');
    setMessage(elements.message, 'Create a private room, then share the invite link with friends.');
    return;
  }
  if (action === 'open') {
    dismissPromo();
    openLobbyPanel('public');
    return;
  }
  if (action === 'share') {
    const { title, text, url } = getShareCopy();
    if (await shareLink(url, title, text)) {
      setMessage(elements.message, 'Thanks for sharing Poker Games Club!');
      dismissPromo();
      clearActivePromoTip();
      renderGame(game, elements);
      return;
    }
    const result = await copyOrShareLink(url, title);
    if (result === 'copy') {
      setMessage(elements.message, 'Link copied — paste it anywhere to invite friends.');
      dismissPromo();
      clearActivePromoTip();
      renderGame(game, elements);
      return;
    }
    const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text} ${url}`)}`;
    window.open(tweet, '_blank', 'noopener,noreferrer');
    setMessage(elements.message, 'Opened a share draft — tweak it and post.');
    return;
  }
  if (action === 'copy') {
    const url = getAppShareUrl();
    if (await copyToClipboard(url)) {
      setMessage(elements.message, 'Site link copied. Send it to a friend!');
      dismissPromo();
      clearActivePromoTip();
      renderGame(game, elements);
      return;
    }
    setMessage(elements.message, `Copy this link: ${url}`);
  }
}

elements.promoPrimaryBtn?.addEventListener('click', () => {
  handlePromoAction(elements.promoPrimaryBtn.dataset.action);
});
elements.promoSecondaryBtn?.addEventListener('click', () => {
  handlePromoAction(elements.promoSecondaryBtn.dataset.action);
});
elements.promoDismissBtn?.addEventListener('click', () => {
  dismissPromo();
  clearActivePromoTip();
  renderGame(game, elements);
});

elements.publicRoomsList?.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-join-public');
  if (!btn || btn.disabled) return;
  joinPublicRoom(btn.dataset.roomId);
});

elements.createRoomBtn.addEventListener('click', async () => {
  try {
    clearSoloState();
    game.soloSessionActive = false;
    const res = await network.createRoom(getPlayerName(), getTableSettings());
    const playerCount = game.playerCount;
    const bigBlind = parseInt(elements.bigBlindSelect.value, 10);
    const startingStack = parseInt(elements.startingStackSelect.value, 10);
    const maxRebuys = parseInt(elements.maxRebuysSelect?.value ?? '3', 10);
    const anteFraction = Number(elements.anteSelect?.value ?? 0);
    const hostName = getPlayerName();
    const members = [{
      id: network.socket?.id,
      name: hostName,
      isHost: true,
      seatIndex: 0,
    }];
    game.startingStack = startingStack;
    game.maxRebuys = maxRebuys;
    game.anteFraction = anteFraction;
    game.setOnlinePlayers(members, playerCount, true);
    game.roomId = res.roomId;
    game.inviteLink = res.inviteLink || '';
    game.tableDetailsOpen = false;
    renderTableDetails(elements, {
      roomId: res.roomId,
      isHost: true,
      localSocketId: network.socket?.id,
      inviteLink: res.inviteLink,
      members,
      settings: { playerCount, bigBlind, startingStack, maxRebuys, anteFraction },
      status: 'lobby',
    });
    inOnlineRoom = true;
    game.onlineMode = true;
    game.isHost = true;
    game.isPublicRoom = false;
    game.allowBots = true;
    game.roomDisplayName = '';
    game.roomStatus = 'lobby';
    game.lobbyPanelMode = null;
    stopPublicRoomsPolling();
    game.localSeatIndex = 0;
    game.tableDetailsOpen = true;
    const copyResult = await copyInviteLink(res.inviteLink || '');
    setMessage(elements.message, inviteLinkMessage(copyResult, { created: true }));
    renderGame(game, elements);
  } catch (err) {
    setMessage(elements.message, err.message);
  }
});

elements.joinRoomBtn.addEventListener('click', async () => {
  const code = normalizeRoomCode(elements.joinRoomCodeInput?.value) || getRoomFromUrl();
  if (!code) {
    showJoinModal(elements, '', { invited: false });
    return;
  }
  await joinRoom(code, false);
});

elements.joinRoomCodeInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    elements.joinRoomBtn?.click();
  }
});

elements.joinModalSubmit?.addEventListener('click', () => {
  const code = normalizeRoomCode(elements.joinModalRoomInput?.value) || pendingInviteRoomId;
  joinInviteRoom(code);
});

elements.joinModalCancel?.addEventListener('click', () => {
  hideJoinModal(elements);
  pendingInviteRoomId = null;
  if (elements.joinModalRoomInput) elements.joinModalRoomInput.readOnly = false;
  clearRoomFromUrl();
  setMessage(elements.message, t('msg.dealPrompt'));
});

elements.joinModalName?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const code = normalizeRoomCode(elements.joinModalRoomInput?.value) || pendingInviteRoomId;
    joinInviteRoom(code);
  }
});

elements.joinModalRoomInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    elements.joinModalName?.focus();
  }
});

elements.leaveSessionBtn?.addEventListener('click', leaveOnlineRoom);

elements.rebuyBtn?.addEventListener('click', async () => {
  if (!game.canRebuy()) return;
  const btn = elements.rebuyBtn;
  if (btn) btn.disabled = true;
  try {
    const res = await network.rebuy();
    if (!res.ok) setMessage(elements.message, res.error || 'Could not rebuy.');
  } finally {
    if (btn) btn.disabled = false;
  }
});

function toggleTableDetails(forceOpen) {
  if (!game.onlineMode || !game.roomId) return;
  game.tableDetailsOpen = typeof forceOpen === 'boolean' ? forceOpen : !game.tableDetailsOpen;
  renderGame(game, elements);
}

elements.tableDetailsBtn?.addEventListener('click', () => toggleTableDetails());
elements.closeTableDetailsBtn?.addEventListener('click', () => toggleTableDetails(false));

elements.lobbyPlayers?.addEventListener('click', async (e) => {
  if (!game.isHost) return;

  const kickBtn = e.target.closest('.btn-kick-player');
  if (kickBtn) {
    const targetId = kickBtn.dataset.memberId;
    const targetName = kickBtn.dataset.memberName || 'this player';
    if (!targetId) return;
    if (!confirm(`Remove ${targetName} from the table?`)) return;
    kickBtn.disabled = true;
    try {
      const res = await network.kickPlayer(targetId);
      if (!res.ok) setMessage(elements.message, res.error || 'Could not remove player.');
    } finally {
      kickBtn.disabled = false;
    }
    return;
  }

  const btn = e.target.closest('.btn-make-host');
  if (!btn) return;
  const targetId = btn.dataset.memberId;
  if (!targetId) return;
  btn.disabled = true;
  try {
    const res = await network.transferHost(targetId);
    if (!res.ok) setMessage(elements.message, res.error || 'Could not transfer host.');
  } finally {
    btn.disabled = false;
  }
});

function leaveOnlineRoom() {
  network.leaveRoom();
  clearRoomSession();
  clearSoloState();
  game.soloSessionActive = false;
  inOnlineRoom = false;
  game.onlineMode = false;
  game.isHost = false;
  game.isPublicRoom = false;
  game.allowBots = true;
  game.roomDisplayName = '';
  game.lobbyPanelMode = null;
  game.roomStatus = 'lobby';
  game.tableDetailsOpen = false;
  game.inviteLink = '';
  game.phase = 'idle';
  game.resetPlayers();
  stopPublicRoomsPolling();
  hideMultiplayerPanel(elements);
  hideJoinModal(elements);
  clearRoomFromUrl();
  setMessage(elements.message, t('msg.dealPrompt'));
  renderGame(game, elements);
}

elements.copyLinkBtn.addEventListener('click', async () => {
  const link = elements.inviteLinkInput?.value || game.inviteLink;
  if (!link) return;
  const result = await copyInviteLink(link);
  setMessage(elements.message, inviteLinkMessage(result));
});

elements.shareLinkBtn?.addEventListener('click', async () => {
  const link = elements.inviteLinkInput?.value || game.inviteLink;
  if (!link) return;
  if (await shareLink(link)) {
    setMessage(elements.message, 'Share the invite link from the sheet.');
  }
});

elements.inviteLinkInput?.addEventListener('click', () => {
  primeLinkInput(elements.inviteLinkInput, elements.inviteLinkInput?.value);
});

elements.inviteLinkInput?.addEventListener('focus', () => {
  primeLinkInput(elements.inviteLinkInput, elements.inviteLinkInput?.value);
});

if (elements.shareLinkBtn && canNativeShare()) {
  elements.shareLinkBtn.classList.remove('hidden');
}

elements.addBotBtn?.addEventListener('click', async () => {
  if (isOnline() && game.isHost) {
    if (!game.canAddBot()) return;
    await pushTableSettings({ playerCount: game.playerCount + 1 });
    return;
  }
  game.addBot();
});

elements.removeBotBtn?.addEventListener('click', async () => {
  if (isOnline() && game.isHost) {
    if (!game.canRemoveBot()) return;
    await pushTableSettings({ playerCount: game.playerCount - 1 });
    return;
  }
  game.removeBot();
});

elements.startingStackSelect?.addEventListener('change', async (e) => {
  const stack = parseInt(e.target.value, 10);
  if (isOnline() && game.isHost) {
    await pushTableSettings({ startingStack: stack });
    return;
  }
  game.setStartingStack(stack);
});

elements.bigBlindSelect.addEventListener('change', async (e) => {
  if (isOnline() && game.isHost) {
    await pushTableSettings({ bigBlind: parseInt(e.target.value, 10) });
    return;
  }
  game.setBigBlind(parseInt(e.target.value, 10));
});

elements.anteSelect?.addEventListener('change', async (e) => {
  const anteFraction = Number(e.target.value);
  if (isOnline() && game.isHost) {
    await pushTableSettings({ anteFraction });
    return;
  }
  game.setAnteFraction(anteFraction);
});

elements.maxRebuysSelect?.addEventListener('change', async (e) => {
  const maxRebuys = parseInt(e.target.value, 10);
  if (isOnline() && game.isHost) {
    await pushTableSettings({ maxRebuys });
    renderGame(game, elements);
    return;
  }
  game.maxRebuys = maxRebuys;
  renderGame(game, elements);
});

elements.foldBtn.addEventListener('click', () => {
  sendAction('fold');
  if (!isOnline() && autoSkipWhenFolded && game.canSkipHand()) {
    setTimeout(() => game.skipRemainingHand(), 50);
  }
});

elements.skipBtn.addEventListener('click', () => game.skipRemainingHand());

elements.autoSkipCheckbox.addEventListener('change', (e) => {
  autoSkipWhenFolded = e.target.checked;
  try { localStorage.setItem('poker-auto-skip', autoSkipWhenFolded ? '1' : '0'); } catch { /* ignore */ }
});

elements.showBotHandsCheckbox.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  if (game.onlineMode) {
    if (game.isPublicRoom || !game.isHost) {
      e.target.checked = !!game.showBotHandsAtEnd;
      return;
    }
    showBotHandsAtEnd = enabled;
    game.setShowBotHandsAtEnd(enabled);
    const ok = await pushTableSettings({ showBotHandsAtEnd: enabled });
    if (!ok) {
      showBotHandsAtEnd = !enabled;
      game.setShowBotHandsAtEnd(!enabled);
      e.target.checked = !enabled;
    }
    return;
  }
  showBotHandsAtEnd = enabled;
  game.setShowBotHandsAtEnd(showBotHandsAtEnd);
  try { localStorage.setItem('poker-show-bot-hands', showBotHandsAtEnd ? '1' : '0'); } catch { /* ignore */ }
});

function setDisplayMode(inBB) {
  showInBB = inBB;
  game.setShowInBB(showInBB);
  try { localStorage.setItem('poker-show-in-bb', showInBB ? '1' : '0'); } catch { /* ignore */ }
}

elements.displayDollarsBtn.addEventListener('click', () => setDisplayMode(false));
elements.displayBBBtn.addEventListener('click', () => setDisplayMode(true));

elements.checkBtn.addEventListener('click', () => sendAction('check'));
elements.callBtn.addEventListener('click', () => {
  const player = game.players[game.activeIndex];
  const toCall = game.getCallAmount();
  if (toCall >= player.chips) sendAction('allin');
  else sendAction('call');
});

elements.raiseSlider.addEventListener('input', (e) => {
  const raw = parseFloat(e.target.value);
  const chips = game.showInBB ? raiseDisplayToChips(game, raw / 10) : raw;
  setRaiseAmount(game, elements, chips);
});

elements.raiseInput.addEventListener('input', (e) => {
  const text = e.target.value.trim();
  if (text === '' || text === '.' || text.endsWith('.')) return;
  const v = parseFloat(text);
  if (!Number.isFinite(v)) return;
  updateRaiseFromChips(game, elements, raiseDisplayToChips(game, v), { syncInput: false });
});

elements.raiseInput.addEventListener('blur', (e) => {
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v)) syncRaiseInputFromChips(game, elements, raiseDisplayToChips(game, v));
});

elements.raiseInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitRaise(false);
  }
});

elements.potPresets.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-preset');
  if (!btn) return;
  const pct = parseFloat(btn.dataset.pct);
  setRaiseAmount(game, elements, game.getRaiseFromPotPercent(pct));
});

elements.raiseBtn.addEventListener('click', () => submitRaise(false));
elements.allInBtn.addEventListener('click', () => submitRaise(true));

elements.accountBtn?.addEventListener('click', async () => {
  const status = await auth.getDbStatus();
  if (!status.db) {
    showAuthModal('login');
    setAuthModalError(status.dbError
      ? `Accounts unavailable: ${status.dbError}`
      : 'Accounts are unavailable — Firestore is not connected.');
    return;
  }
  showAuthModal('login');
});
elements.accountUser?.addEventListener('click', () => showAccountModal());
elements.logoutBtn?.addEventListener('click', () => {
  auth.logout();
  updateAccountUI();
  setMessage(elements.message, t('msg.signedOut'));
});

function syncLangMenu() {
  const code = getLanguage();
  if (elements.langCurrent) {
    elements.langCurrent.textContent = code === 'zh' ? '中文' : code.toUpperCase();
  }
  elements.langOptions?.querySelectorAll('.lang-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === code);
    btn.setAttribute('aria-selected', btn.dataset.lang === code ? 'true' : 'false');
  });
}

function closeLangMenu() {
  elements.langOptions?.classList.add('hidden');
  elements.langBtn?.setAttribute('aria-expanded', 'false');
}

function toggleLangMenu() {
  const open = elements.langOptions?.classList.contains('hidden');
  elements.langOptions?.classList.toggle('hidden', !open);
  elements.langBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

elements.langBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleLangMenu();
});
elements.langOptions?.addEventListener('click', (e) => {
  const btn = e.target.closest('.lang-option');
  if (!btn?.dataset.lang) return;
  setLanguage(btn.dataset.lang);
  syncLangMenu();
  closeLangMenu();
  applyDomTranslations();
  setAuthTab(authTab);
  updateAccountUI();
  renderGame(game, elements);
  refreshPublicRooms();
});
document.addEventListener('click', (e) => {
  if (!elements.langMenu?.contains(e.target)) closeLangMenu();
});

elements.authTabLogin?.addEventListener('click', () => setAuthTab('login'));
elements.authTabRegister?.addEventListener('click', () => setAuthTab('register'));
elements.authSubmitBtn?.addEventListener('click', () => handleAuthSubmit());
elements.authCancelBtn?.addEventListener('click', () => hideAuthModal());
bindPasswordToggle(elements.authPassword, elements.authPasswordToggle);
bindPasswordToggle(elements.authPasswordConfirm, elements.authPasswordConfirmToggle);
elements.authPasswordConfirm?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAuthSubmit();
});
elements.authForgotBtn?.addEventListener('click', () => {
  showForgotModal(elements.authEmail?.value?.trim() || '');
});
elements.authResendBtn?.addEventListener('click', () => handleResendVerification());
elements.accountSaveBtn?.addEventListener('click', () => handleAccountSave());
elements.accountCancelBtn?.addEventListener('click', () => hideAccountModal());
elements.accountDeleteBtn?.addEventListener('click', () => handleAccountDelete());
elements.accountDeletePassword?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAccountDelete();
});
elements.accountDisplayName?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAccountSave();
});
elements.forgotSubmitBtn?.addEventListener('click', () => handleForgotSubmit());
elements.forgotCancelBtn?.addEventListener('click', () => hideForgotModal());
elements.forgotEmail?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleForgotSubmit();
});
elements.resetSubmitBtn?.addEventListener('click', () => handleResetSubmit());
elements.resetCancelBtn?.addEventListener('click', () => hideResetPasswordModal());
elements.resetPassword?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleResetSubmit();
});
elements.authPassword?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAuthSubmit();
});
elements.authEmail?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') elements.authPassword?.focus();
});

renderGame(game, elements);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderGame(game, elements), 100);
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => renderGame(game, elements), 150);
});

async function tryRestoreSoloSession() {
  let state = null;
  if (auth.isLoggedIn()) {
    state = await auth.loadSoloGame();
  }
  if (!state) state = loadSoloState();
  if (!state?.sessionActive) {
    if (state) clearSoloState();
    return false;
  }
  if (!game.restoreSoloState(state)) {
    clearSoloState();
    if (auth.isLoggedIn()) auth.clearSoloGame();
    return false;
  }
  saveSoloState(state);
  game.setShowBotHandsAtEnd(showBotHandsAtEnd);
  game.setShowInBB(showInBB);
  syncSoloUIFromGame();
  const betweenHands = game.phase === 'idle' || game.phase === 'showdown';
  setMessage(
    elements.message,
    betweenHands ? 'Restored your game.' : 'Restored your hand.',
  );
  renderGame(game, elements);
  return true;
}

async function tryRestoreOnlineSession() {
  const session = loadRoomSession();
  if (!session) return false;
  try {
    setMessage(elements.message, 'Reconnecting to your table…');
    await network.reconnectRoom(session.roomId, session.name, session.memberToken);
    return true;
  } catch {
    clearRoomSession();
    return false;
  }
}

const roomFromUrl = getRoomFromUrl();
initI18n();
syncLangMenu();
initPwa();
(async () => {
  accountsEnabled = await auth.checkDbAvailable();
  passwordResetEnabled = await auth.isPasswordResetAvailable();
  emailVerificationEnabled = await auth.isEmailVerificationAvailable();
  if (accountsEnabled) await auth.initAuth();
  updateAccountUI();

  const verifyToken = consumeVerifyTokenFromUrl();
  if (verifyToken && accountsEnabled) {
    await handleEmailVerificationFromUrl(verifyToken);
    return;
  }

  const resetToken = consumeResetTokenFromUrl();
  if (resetToken && accountsEnabled && passwordResetEnabled) {
    showResetPasswordModal(resetToken);
    return;
  }

  if (await tryRestoreOnlineSession()) return;
  if (await tryRestoreSoloSession()) return;
  if (roomFromUrl) {
    pendingInviteRoomId = roomFromUrl;
    showJoinModal(elements, roomFromUrl, { invited: true });
  } else {
    setMessage(elements.message, t('msg.dealPrompt'));
  }
})();
