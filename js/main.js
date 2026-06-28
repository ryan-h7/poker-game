import { PokerGame } from './game.js';
import {
  renderGame, setMessage, setRaiseAmount, getSelectedRaiseAmount,
  raiseDisplayToChips, syncRaiseInputFromChips, updateRaiseFromChips,
  showMultiplayerEntry, hideMultiplayerPanel,
  showJoinModal, hideJoinModal, setJoinModalError, renderTableDetails,
} from './ui.js';
import { NetworkClient, getRoomFromUrl, clearRoomFromUrl, normalizeRoomCode, loadRoomSession, clearRoomSession, saveSoloState, loadSoloState, clearSoloState } from './network.js';
import {
  copyOrShareLink, shareLink, primeLinkInput, canNativeShare, isMobileDevice,
} from './clipboard.js';

const elements = {
  community: document.getElementById('community'),
  seats: document.getElementById('seats'),
  pot: document.getElementById('pot'),
  phase: document.getElementById('phase'),
  log: document.getElementById('log'),
  message: document.getElementById('message'),
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
  resetSoloBtn: document.getElementById('btn-reset-solo'),
  playFriendsBtn: document.getElementById('btn-play-friends'),
  addBotBtn: document.getElementById('btn-add-bot'),
  removeBotBtn: document.getElementById('btn-remove-bot'),
  botCountLabel: document.getElementById('bot-count'),
  tableSizeHint: document.getElementById('table-size-hint'),
  startingStackSelect: document.getElementById('starting-stack'),
  bigBlindSelect: document.getElementById('big-blind'),
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
  multiplayerPanel: document.getElementById('multiplayer-panel'),
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
};

let autoSkipWhenFolded = false;
let showBotHandsAtEnd = false;
let showInBB = false;
let inOnlineRoom = false;
let pendingInviteRoomId = null;
let soloSaveTimer;

function scheduleSoloSave() {
  if (game.onlineMode || game.replaying) return;
  clearTimeout(soloSaveTimer);
  soloSaveTimer = setTimeout(() => {
    if (game.onlineMode || game.replaying) return;
    if (!game.soloSessionActive) {
      clearSoloState();
      return;
    }
    const state = game.exportSoloState();
    if (state) saveSoloState(state);
  }, 250);
}

function syncSoloUIFromGame() {
  if (elements.startingStackSelect) {
    elements.startingStackSelect.value = String(game.startingStack);
  }
  if (elements.bigBlindSelect) {
    elements.bigBlindSelect.value = String(game.bigBlind);
  }
}

try {
  autoSkipWhenFolded = localStorage.getItem('poker-auto-skip') === '1';
  if (elements.autoSkipCheckbox) elements.autoSkipCheckbox.checked = autoSkipWhenFolded;
  showBotHandsAtEnd = localStorage.getItem('poker-show-bot-hands') === '1';
  if (elements.showBotHandsCheckbox) elements.showBotHandsCheckbox.checked = showBotHandsAtEnd;
  showInBB = localStorage.getItem('poker-show-in-bb') === '1';
  const savedName = localStorage.getItem('poker-player-name');
  if (savedName) {
    if (elements.playerNameInput) elements.playerNameInput.value = savedName;
    if (elements.joinModalName) elements.joinModalName.value = savedName;
  }
} catch { /* ignore */ }

const game = new PokerGame(
  () => {
    renderGame(game, elements);
    scheduleSoloSave();
  },
  (msg) => setMessage(elements.message, msg),
);
game.setShowBotHandsAtEnd(showBotHandsAtEnd);
game.setShowInBB(showInBB);

const network = new NetworkClient({
  onLobby: (lobby) => {
    inOnlineRoom = true;
    game.onlineMode = true;
    game.roomStatus = lobby.status || 'lobby';
    game.lobbyPanelOpen = false;
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
    game.roomId = lobby.roomId;
    game.inviteLink = lobby.inviteLink || game.inviteLink;
    game.setOnlinePlayers(lobby.members, lobby.settings.playerCount, true);
    hideJoinModal(elements);
    renderTableDetails(elements, {
      roomId: lobby.roomId,
      isHost: lobby.isHost,
      localSocketId: network.socket?.id,
      inviteLink: lobby.inviteLink,
      members: lobby.members,
      settings: lobby.settings,
      status: lobby.status,
    });
    if (lobby.message) {
      setMessage(elements.message, lobby.message);
    } else if (game.roomStatus === 'lobby') {
      setMessage(elements.message, lobby.isHost
        ? 'Share the invite link. Deal when everyone has joined.'
        : 'You\'re in the lobby — waiting for the host to deal.');
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
    game.lobbyPanelOpen = false;
    if (state.inviteLink) game.inviteLink = state.inviteLink;
    if (state.message) setMessage(elements.message, state.message);
    renderGame(game, elements);
  },
  onKicked: (reason) => {
    clearSoloState();
    game.soloSessionActive = false;
    inOnlineRoom = false;
    game.onlineMode = false;
    game.isHost = false;
    game.lobbyPanelOpen = false;
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

function getPlayerName(fromModal = false) {
  const raw = fromModal
    ? elements.joinModalName?.value
    : elements.playerNameInput?.value;
  const name = String(raw || 'Player').trim() || 'Player';
  try { localStorage.setItem('poker-player-name', name); } catch { /* ignore */ }
  if (elements.playerNameInput) elements.playerNameInput.value = name;
  if (elements.joinModalName) elements.joinModalName.value = name;
  return name.slice(0, 16);
}

function getTableSettings() {
  return {
    playerCount: game.playerCount,
    bigBlind: parseInt(elements.bigBlindSelect.value, 10),
    startingStack: parseInt(elements.startingStackSelect.value, 10),
    maxRebuys: parseInt(elements.maxRebuysSelect?.value ?? '3', 10),
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

elements.resetSoloBtn?.addEventListener('click', () => {
  if (game.onlineMode || !game.soloSessionActive) return;
  const ok = window.confirm(
    'Reset the game? Chip stacks, dealer position, and hand history will be cleared.',
  );
  if (!ok) return;
  game.resetSoloSession();
  clearSoloState();
  setMessage(elements.message, 'Game reset. Click "Deal Hand" to start fresh.');
  renderGame(game, elements);
});

elements.playFriendsBtn?.addEventListener('click', () => {
  game.lobbyPanelOpen = true;
  showMultiplayerEntry(elements);
  setMessage(elements.message, 'Enter your name, then create or join a room.');
  elements.multiplayerPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderGame(game, elements);
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
    const hostName = getPlayerName();
    const members = [{
      id: network.socket?.id,
      name: hostName,
      isHost: true,
      seatIndex: 0,
    }];
    game.startingStack = startingStack;
    game.maxRebuys = maxRebuys;
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
      settings: { playerCount, bigBlind, startingStack, maxRebuys },
      status: 'lobby',
    });
    inOnlineRoom = true;
    game.onlineMode = true;
    game.isHost = true;
    game.roomStatus = 'lobby';
    game.lobbyPanelOpen = false;
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
  setMessage(elements.message, 'Click "Deal Hand" to play solo, or "Play with Friends" to host a room.');
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
  game.lobbyPanelOpen = false;
  game.roomStatus = 'lobby';
  game.tableDetailsOpen = false;
  game.inviteLink = '';
  game.phase = 'idle';
  game.resetPlayers();
  hideMultiplayerPanel(elements);
  hideJoinModal(elements);
  clearRoomFromUrl();
  setMessage(elements.message, 'Left the room.');
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

elements.showBotHandsCheckbox.addEventListener('change', (e) => {
  if (game.onlineMode) {
    e.target.checked = false;
    return;
  }
  showBotHandsAtEnd = e.target.checked;
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
  const state = loadSoloState();
  if (!state?.sessionActive) {
    if (state) clearSoloState();
    return false;
  }
  if (!game.restoreSoloState(state)) {
    clearSoloState();
    return false;
  }
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
(async () => {
  if (await tryRestoreOnlineSession()) return;
  if (await tryRestoreSoloSession()) return;
  if (roomFromUrl) {
    pendingInviteRoomId = roomFromUrl;
    showJoinModal(elements, roomFromUrl, { invited: true });
  } else {
    setMessage(elements.message, 'Click "Deal Hand" to play solo, or "Play with Friends" to host a room.');
  }
})();
