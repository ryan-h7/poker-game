import { PokerGame } from './game.js';
import {
  renderGame, setMessage, setRaiseAmount, getSelectedRaiseAmount,
  raiseDisplayToChips, syncRaiseInputFromChips, updateRaiseFromChips,
  renderLobby, showMultiplayerEntry, hideMultiplayerPanel,
  showJoinModal, hideJoinModal, setJoinModalError,
} from './ui.js';
import { NetworkClient, getRoomFromUrl, clearRoomFromUrl } from './network.js';

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
  playFriendsBtn: document.getElementById('btn-play-friends'),
  playerCountSelect: document.getElementById('player-count'),
  bigBlindSelect: document.getElementById('big-blind'),
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
  lobbyActive: document.getElementById('lobby-active'),
  playerNameInput: document.getElementById('player-name'),
  createRoomBtn: document.getElementById('btn-create-room'),
  joinRoomBtn: document.getElementById('btn-join-room'),
  leaveRoomBtn: document.getElementById('btn-leave-room'),
  copyLinkBtn: document.getElementById('btn-copy-link'),
  inviteLinkInput: document.getElementById('invite-link'),
  lobbyRoomCode: document.getElementById('lobby-room-code'),
  lobbyPlayers: document.getElementById('lobby-players'),
  lobbyHint: document.getElementById('lobby-hint'),
  joinModal: document.getElementById('join-modal'),
  joinModalRoomCode: document.getElementById('join-modal-room-code'),
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
  () => renderGame(game, elements),
  (msg) => setMessage(elements.message, msg),
);
game.setShowBotHandsAtEnd(showBotHandsAtEnd);
game.setShowInBB(showInBB);

const network = new NetworkClient({
  onLobby: (lobby) => {
    inOnlineRoom = true;
    game.onlineMode = true;
    game.lobbyPanelOpen = true;
    game.isHost = lobby.isHost;
    const me = lobby.members.find(m => m.id === network.socket?.id);
    if (me) game.localSeatIndex = me.seatIndex;
    game.playerCount = lobby.settings.playerCount;
    game.bigBlind = lobby.settings.bigBlind;
    hideJoinModal(elements);
    renderLobby(elements, lobby);
    setMessage(elements.message, lobby.isHost
      ? 'Share the invite link. Deal when everyone has joined.'
      : 'You\'re in the lobby — waiting for the host to deal.');
    renderGame(game, elements);
  },
  onGameState: (state) => {
    inOnlineRoom = true;
    hideJoinModal(elements);
    game.applyNetworkState(state);
    game.isHost = state.isHost;
    game.localSeatIndex = state.localSeatIndex;
    game.lobbyPanelOpen = state.phase === 'idle' || state.phase === 'showdown';
    setMessage(elements.message, state.message || '');
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

function isOnline() {
  return inOnlineRoom && game.onlineMode;
}

async function joinInviteRoom(roomId) {
  const btn = elements.joinModalSubmit;
  if (btn) btn.disabled = true;
  setJoinModalError(elements, '');
  try {
    await network.joinRoom(roomId, getPlayerName(true));
    pendingInviteRoomId = null;
  } catch (err) {
    setJoinModalError(elements, err.message || 'Could not join room.');
  } finally {
    if (btn) btn.disabled = false;
  }
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

elements.playFriendsBtn?.addEventListener('click', () => {
  game.lobbyPanelOpen = true;
  showMultiplayerEntry(elements);
  setMessage(elements.message, 'Enter your name, then create a room.');
  elements.multiplayerPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderGame(game, elements);
});

elements.createRoomBtn.addEventListener('click', async () => {
  try {
    const res = await network.createRoom(getPlayerName());
    renderLobby(elements, {
      roomId: res.roomId,
      isHost: true,
      inviteLink: res.inviteLink,
      message: 'Room created! Share the link with friends.',
      settings: {
        playerCount: parseInt(elements.playerCountSelect.value, 10),
        bigBlind: parseInt(elements.bigBlindSelect.value, 10),
      },
      members: [{ name: getPlayerName(), isHost: true, seatIndex: 0 }],
    });
    inOnlineRoom = true;
    game.onlineMode = true;
    game.isHost = true;
    game.lobbyPanelOpen = true;
    game.localSeatIndex = 0;
    setMessage(elements.message, 'Room created! Share the invite link.');
    renderGame(game, elements);
  } catch (err) {
    setMessage(elements.message, err.message);
  }
});

elements.joinRoomBtn.addEventListener('click', async () => {
  const roomId = getRoomFromUrl();
  if (!roomId) {
    setMessage(elements.message, 'Open a friend\'s invite link, or add ?room=CODE to the URL.');
    return;
  }
  try {
    await network.joinRoom(roomId, getPlayerName());
  } catch (err) {
    setMessage(elements.message, err.message);
  }
});

elements.joinModalSubmit?.addEventListener('click', () => {
  if (pendingInviteRoomId) joinInviteRoom(pendingInviteRoomId);
});

elements.joinModalCancel?.addEventListener('click', () => {
  hideJoinModal(elements);
  pendingInviteRoomId = null;
  clearRoomFromUrl();
  setMessage(elements.message, 'Click "Deal Hand" to play solo, or "Play with Friends" to host a room.');
});

elements.joinModalName?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && pendingInviteRoomId) {
    e.preventDefault();
    joinInviteRoom(pendingInviteRoomId);
  }
});

elements.leaveRoomBtn.addEventListener('click', () => {
  network.leaveRoom();
  inOnlineRoom = false;
  game.onlineMode = false;
  game.isHost = false;
  game.lobbyPanelOpen = false;
  game.phase = 'idle';
  game.resetPlayers();
  hideMultiplayerPanel(elements);
  hideJoinModal(elements);
  clearRoomFromUrl();
  setMessage(elements.message, 'Left the room.');
  renderGame(game, elements);
});

elements.copyLinkBtn.addEventListener('click', async () => {
  const link = elements.inviteLinkInput?.value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    setMessage(elements.message, 'Invite link copied!');
  } catch {
    elements.inviteLinkInput?.select();
    setMessage(elements.message, 'Copy the link manually (Ctrl+C).');
  }
});

elements.playerCountSelect.addEventListener('change', async (e) => {
  if (isOnline() && game.isHost) {
    await network.updateSettings({
      playerCount: parseInt(e.target.value, 10),
      bigBlind: parseInt(elements.bigBlindSelect.value, 10),
    });
    return;
  }
  game.setPlayerCount(parseInt(e.target.value, 10));
});

elements.bigBlindSelect.addEventListener('change', async (e) => {
  if (isOnline() && game.isHost) {
    await network.updateSettings({
      playerCount: parseInt(elements.playerCountSelect.value, 10),
      bigBlind: parseInt(e.target.value, 10),
    });
    return;
  }
  game.setBigBlind(parseInt(e.target.value, 10));
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

const roomFromUrl = getRoomFromUrl();
if (roomFromUrl) {
  pendingInviteRoomId = roomFromUrl;
  showJoinModal(elements, roomFromUrl);
} else {
  setMessage(elements.message, 'Click "Deal Hand" to play solo, or "Play with Friends" to host a room.');
}
