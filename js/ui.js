import { SUIT_COLORS } from './engine.js';

export const POT_BET_PRESETS = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25];

let raiseTurnKey = '';

export function raiseDisplayToChips(game, displayValue) {
  if (!game.showInBB) return Math.floor(displayValue);
  return game.clampRaiseTotal(Math.round(displayValue * game.bigBlind));
}

function formatRaiseDisplay(game, chips) {
  if (!game.showInBB) return String(chips);
  const bb = chips / game.bigBlind;
  const rounded = Math.round(bb * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

export function updateRaiseFromChips(game, elements, amount, { syncInput = true } = {}) {
  const { raiseSlider, raiseInput, raiseBtn, raiseHint, raiseInputLabel } = elements;
  const clamped = game.clampRaiseTotal(amount);
  const display = formatRaiseDisplay(game, clamped);
  const inputFocused = raiseInput && document.activeElement === raiseInput;

  if (raiseSlider) {
    raiseSlider.value = game.showInBB
      ? String(Math.round(clamped / game.bigBlind * 10))
      : String(clamped);
  }
  if (raiseInput && syncInput && !inputFocused) raiseInput.value = display;
  if (raiseInputLabel) raiseInputLabel.textContent = game.showInBB ? 'Raise to (BB)' : 'Raise to $';
  if (raiseBtn) raiseBtn.textContent = `Raise to ${game.formatAmount(clamped)}`;
  updatePresetHighlight(game, elements, clamped);
  if (raiseHint) {
    const pct = potPercentForAmount(game, clamped);
    raiseHint.textContent = pct != null ? `≈ ${Math.round(pct * 100)}% pot` : '';
  }
  return clamped;
}

export function setRaiseAmount(game, elements, amount) {
  updateRaiseFromChips(game, elements, amount, { syncInput: true });
}

function potPercentForAmount(game, totalBet) {
  const p = game.players[game.activeIndex];
  if (!p) return null;
  const toCall = game.currentBet - p.bet;
  const added = totalBet - p.bet;
  if (added <= 0) return null;
  if (toCall === 0) {
    return game.pot > 0 ? added / game.pot : null;
  }
  const potAfterCall = game.pot + toCall;
  const raiseBy = added - toCall;
  return potAfterCall > 0 ? raiseBy / potAfterCall : null;
}

function updatePresetHighlight(game, elements, amount) {
  const { potPresets } = elements;
  if (!potPresets) return;
  const pct = potPercentForAmount(game, amount);
  potPresets.querySelectorAll('.btn-preset').forEach((btn) => {
    const target = parseFloat(btn.dataset.pct);
    const match = pct != null && Math.abs(pct - target) < 0.04;
    btn.classList.toggle('active', match);
  });
}

function syncRaiseControls(game, elements) {
  const { raiseSlider, raiseInput, raiseBtn, allInBtn } = elements;
  const player = game.players[game.activeIndex];
  if (!player || !raiseSlider) return;

  const min = game.getMinRaiseTotal();
  const max = player.bet + player.chips;
  const key = `${game.phase}-${game.activeIndex}-${game.currentBet}-${game.pot}-${player.chips}-${game.showInBB}`;

  if (game.showInBB) {
    const bb = game.bigBlind;
    raiseSlider.min = Math.max(1, Math.ceil(min / bb * 10));
    raiseSlider.max = Math.max(raiseSlider.min, Math.floor(max / bb * 10));
    if (raiseInput) {
      raiseInput.min = min / bb;
      raiseInput.max = max / bb;
      raiseInput.step = 'any';
    }
  } else {
    raiseSlider.min = min;
    raiseSlider.max = max;
    if (raiseInput) {
      raiseInput.min = min;
      raiseInput.max = max;
      raiseInput.step = 1;
    }
  }

  const canRaise = max > game.currentBet;
  if (raiseBtn) raiseBtn.disabled = !canRaise;
  if (allInBtn) allInBtn.disabled = player.chips <= 0;

  if (key !== raiseTurnKey && document.activeElement !== raiseInput) {
    raiseTurnKey = key;
    setRaiseAmount(game, elements, game.getRaiseFromPotPercent(0.5));
  }
}

export function getSelectedRaiseAmount(game, elements) {
  const { raiseInput, raiseSlider } = elements;

  if (raiseInput && document.activeElement === raiseInput) {
    const raw = parseFloat(raiseInput.value);
    if (!Number.isFinite(raw)) return game.clampRaiseTotal(game.getMinRaiseTotal());
    return raiseDisplayToChips(game, raw);
  }

  const sliderRaw = parseFloat(raiseSlider?.value);
  if (!Number.isFinite(sliderRaw)) return game.clampRaiseTotal(game.getMinRaiseTotal());
  if (game.showInBB) return raiseDisplayToChips(game, sliderRaw / 10);
  return game.clampRaiseTotal(sliderRaw);
}

export function syncRaiseInputFromChips(game, elements, amount) {
  return updateRaiseFromChips(game, elements, amount, { syncInput: true });
}

function getViewSeatIndex(game, seatIndex) {
  const total = game.players.length;
  const pivot = game.onlineMode ? game.localSeatIndex : 0;
  return (seatIndex - pivot + total) % total;
}

function getSeatPosition(index, total) {
  const angle = (Math.PI / 2) + (index * 2 * Math.PI) / total;
  const x = 50 + 38 * Math.cos(angle);
  const y = 50 + 42 * Math.sin(angle);
  return {
    left: `${x}%`,
    top: `${y}%`,
    transform: 'translate(-50%, -50%)',
  };
}

export function showJoinModal(elements, roomId = '', { invited = false } = {}) {
  const {
    joinModal, joinModalRoomInput, joinModalName, joinModalError,
    joinModalTitle, joinModalSub,
  } = elements;
  if (!joinModal) return;
  if (joinModalRoomInput) {
    joinModalRoomInput.value = roomId || '';
    joinModalRoomInput.readOnly = invited;
  }
  if (joinModalTitle) {
    joinModalTitle.textContent = invited ? "Join friend's game" : 'Join a game';
  }
  if (joinModalSub) {
    joinModalSub.textContent = invited
      ? "You've been invited to a poker table."
      : 'Enter the room code from your friend.';
  }
  if (joinModalError) {
    joinModalError.textContent = '';
    joinModalError.classList.add('hidden');
  }
  joinModal.classList.remove('hidden');
  document.body.classList.add('modal-open', 'invite-join-pending');
  (invited ? joinModalName : joinModalRoomInput)?.focus();
}

export function hideJoinModal(elements) {
  elements.joinModal?.classList.add('hidden');
  document.body.classList.remove('modal-open', 'invite-join-pending');
  if (elements.joinModalRoomInput) elements.joinModalRoomInput.readOnly = false;
  if (elements.joinModalError) {
    elements.joinModalError.textContent = '';
    elements.joinModalError.classList.add('hidden');
  }
}

export function setJoinModalError(elements, message) {
  if (!elements.joinModalError) return;
  elements.joinModalError.textContent = message;
  elements.joinModalError.classList.toggle('hidden', !message);
}

export function renderLobby(elements, lobby) {
  const {
    multiplayerPanel, lobbyEntry, lobbyActive, lobbyRoomCode, lobbyPlayers,
    inviteLinkInput, createRoomBtn, joinRoomBtn, lobbyHint, leaveRoomBtn,
  } = elements;
  if (!multiplayerPanel || !lobby) return;

  multiplayerPanel.classList.remove('hidden');
  lobbyEntry?.classList.add('hidden');
  lobbyActive?.classList.remove('hidden');
  leaveRoomBtn?.classList.remove('hidden');

  if (lobbyRoomCode) lobbyRoomCode.textContent = lobby.roomId;
  if (inviteLinkInput && lobby.inviteLink) inviteLinkInput.value = lobby.inviteLink;
  if (lobbyHint) {
    lobbyHint.textContent = lobby.isHost
      ? 'Share the link below. Start when at least 2 players have joined.'
      : 'Waiting for the host to deal…';
  }

  if (lobbyPlayers) {
    lobbyPlayers.innerHTML = lobby.members.map(m => `
      <li class="lobby-player">
        <span>${m.name}${m.isHost ? ' (host)' : ''}</span>
        <span class="lobby-seat">Seat ${m.seatIndex + 1}</span>
      </li>
    `).join('');
  }

  if (elements.startingStackSelect && lobby.settings?.startingStack) {
    elements.startingStackSelect.value = String(lobby.settings.startingStack);
  }
  if (elements.bigBlindSelect && lobby.settings) {
    elements.bigBlindSelect.value = String(lobby.settings.bigBlind);
  }

  if (elements.lobbyTableSettings && lobby.settings) {
    const humans = lobby.members.length;
    const bots = Math.max(0, lobby.settings.playerCount - humans);
    const stack = lobby.settings.startingStack ?? 1000;
    elements.lobbyTableSettings.textContent =
      `${lobby.settings.playerCount} players (${humans} human${humans === 1 ? '' : 's'}, ${bots} bot${bots === 1 ? '' : 's'}) · $${stack.toLocaleString()} stacks · $${lobby.settings.bigBlind} BB`;
  }
}

export function hideMultiplayerPanel(elements) {
  elements.multiplayerPanel?.classList.add('hidden');
}

export function showMultiplayerEntry(elements) {
  elements.multiplayerPanel?.classList.remove('hidden');
  elements.lobbyEntry?.classList.remove('hidden');
  elements.lobbyActive?.classList.add('hidden');
  elements.leaveRoomBtn?.classList.add('hidden');
  elements.lobbyRoomCode && (elements.lobbyRoomCode.textContent = '—');
  elements.lobbyPlayers && (elements.lobbyPlayers.innerHTML = '');
  elements.inviteLinkInput && (elements.inviteLinkInput.value = '');
}

export function renderGame(game, elements) {
  renderCommunity(game, elements.community);
  renderPlayers(game, elements.seats);
  renderPot(game, elements.pot);
  renderControls(game, elements);
  renderLog(game, elements.log, elements.message);
  renderPhase(game, elements.phase);
  if (elements.stopReplayBtn) {
    elements.stopReplayBtn.classList.toggle('hidden', !game.replaying);
  }
  if (elements.displayModeBar) {
    elements.displayModeBar.classList.toggle('hidden', game.phase === 'idle' || game.replaying);
  }
}

function cardHTML(card, hidden = false, extraClass = '') {
  if (hidden) {
    return `<div class="card card-back ${extraClass}"><span class="card-back-pattern"></span></div>`;
  }
  const color = SUIT_COLORS[card.suit];
  return `<div class="card ${color} ${extraClass}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

function peekCardHTML(card) {
  return `<div class="card-slot card-peek">${cardHTML(card, true, 'card-peek-back')}${cardHTML(card, false, 'card-peek-face')}</div>`;
}

function renderCommunity(game, el) {
  const slots = 5;
  let html = '';
  for (let i = 0; i < slots; i++) {
    html += game.community[i]
      ? cardHTML(game.community[i])
      : `<div class="card card-empty"></div>`;
  }
  el.innerHTML = html;
}

function renderPlayers(game, el) {
  el.innerHTML = game.players.map((p, i) => {
    const viewIndex = getViewSeatIndex(game, i);
    const pos = getSeatPosition(viewIndex, game.players.length);
    const style = Object.entries(pos).map(([k, v]) => `${k}: ${v}`).join(';');
    const isActive = game.players[game.activeIndex]?.id === p.id &&
      game.phase !== 'idle' && game.phase !== 'showdown';
    const isDealer = i === game.dealerIndex;
    const showCards = (game.onlineMode ? i === game.localSeatIndex : p.isHuman)
      || (game.showBotHandsAtEnd && game.handsRevealed)
      || (game.phase === 'showdown' && !p.folded);
    const folded = p.folded;
    const faceDown = !showCards || (folded && !(game.showBotHandsAtEnd && game.handsRevealed));
    const peekFolded = (game.onlineMode ? i === game.localSeatIndex : p.isHuman) && folded && faceDown;
    const youTag = game.onlineMode && i === game.localSeatIndex ? ' (you)' : '';
    const displayName = game.onlineMode ? game.getSeatDisplayName(i) : p.name;

    const cards = p.hole.length
      ? p.hole.map(c => peekFolded ? peekCardHTML(c) : cardHTML(c, faceDown)).join('')
      : '<div class="card card-empty"></div><div class="card card-empty"></div>';

    return `<div class="player-seat ${isActive ? 'active' : ''} ${folded ? 'folded' : ''} ${peekFolded ? 'peek-cards' : ''}" style="${style}">
      ${isDealer ? '<span class="dealer-button">D</span>' : ''}
      <div class="player-cards">${cards}</div>
      <div class="player-info">
        <span class="player-name">${displayName}${youTag}</span>
        <span class="player-chips">${game.formatAmount(p.chips)}</span>
        ${p.bet > 0 ? `<span class="player-bet">Bet: ${game.formatAmount(p.bet)}</span>` : ''}
        ${folded ? '<span class="player-status">Folded</span>' : ''}
        ${p.chips === 0 && p.inHand && !p.folded ? '<span class="player-status allin">All-In</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

function renderPot(game, el) {
  el.textContent = game.pot > 0 ? `Pot: ${game.formatAmount(game.pot)}` : '';
}

function renderPhase(game, el) {
  if (game.replaying) {
    el.textContent = 'Replay';
    return;
  }
  const labels = {
    idle: 'Ready',
    preflop: 'Pre-Flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
  };
  el.textContent = labels[game.phase] || game.phase;
}

function renderControls(game, elements) {
  const {
    controls, foldBtn, checkBtn, callBtn, raiseBtn, raiseSlider, raiseInput,
    allInBtn, potPresets, raiseHint, newHandBtn, replayHandBtn, bigBlindSelect,
    startingStackSelect, addBotBtn, removeBotBtn, botCountLabel, tableSizeHint,
    setupBar, skipBar, skipBtn, displayModeBar, displayDollarsBtn, displayBBBtn,
  } = elements;
  const canConfigure = game.canChangeSettings();
  const inMatch = game.phase !== 'idle' && !game.replaying;
  const hostOrSolo = !game.onlineMode || game.isHost;

  if (displayModeBar) displayModeBar.classList.toggle('hidden', !inMatch);
  if (displayDollarsBtn) displayDollarsBtn.classList.toggle('active', !game.showInBB);
  if (displayBBBtn) displayBBBtn.classList.toggle('active', game.showInBB);

  if (setupBar) {
    const inOnlineLobby = game.onlineMode && (game.phase === 'idle' || game.phase === 'showdown');
    if (inOnlineLobby && !game.isHost) {
      setupBar.classList.add('hidden');
    } else {
      setupBar.classList.toggle('hidden', !canConfigure);
    }
  }
  if (skipBar) skipBar.classList.toggle('hidden', !game.canSkipHand());
  if (skipBtn) skipBtn.disabled = game.fastForward;

  const configDisabled = !canConfigure || !hostOrSolo;
  if (botCountLabel) botCountLabel.textContent = String(game.getBotCount());
  if (tableSizeHint) {
    const humans = game.getHumanCount();
    tableSizeHint.textContent = `${game.playerCount} players (${humans} human${humans === 1 ? '' : 's'})`;
  }
  if (addBotBtn) addBotBtn.disabled = configDisabled || !game.canAddBot();
  if (removeBotBtn) removeBotBtn.disabled = configDisabled || !game.canRemoveBot();
  if (startingStackSelect) {
    startingStackSelect.value = String(game.startingStack);
    startingStackSelect.disabled = configDisabled;
  }
  if (bigBlindSelect) {
    bigBlindSelect.value = String(game.bigBlind);
    bigBlindSelect.disabled = configDisabled;
  }

  const isTurn = game.isHumanTurn();
  const inHand = game.phase !== 'idle' && game.phase !== 'showdown';

  if (elements.leaveRoomBtn) elements.leaveRoomBtn.classList.toggle('hidden', !game.onlineMode);
  const showLobby = game.onlineMode || game.lobbyPanelOpen;
  if (elements.multiplayerPanel) {
    elements.multiplayerPanel.classList.toggle('hidden', !showLobby || inHand);
  }
  if (elements.playFriendsBtn) {
    elements.playFriendsBtn.classList.toggle('hidden', game.onlineMode);
  }

  if (game.phase === 'idle' || game.phase === 'showdown') {
    controls.classList.add('hidden');
    const lowChips = game.players.filter(p => p.chips > 0).length < 2;
    if (newHandBtn) {
      newHandBtn.disabled = game.replaying
        || lowChips
        || (game.onlineMode && !game.isHost);
      newHandBtn.textContent = game.onlineMode ? 'Deal Hand (Host)' : 'Deal Hand';
    }
    if (replayHandBtn) replayHandBtn.disabled = !game.canReplayHand();
    return;
  }

  controls.classList.toggle('hidden', !isTurn);

  if (!isTurn) return;

  const player = game.players[game.activeIndex];
  const toCall = game.getCallAmount();
  const canCheck = toCall === 0;

  foldBtn.disabled = false;
  checkBtn.disabled = !canCheck;
  checkBtn.classList.toggle('hidden', !canCheck);
  callBtn.classList.toggle('hidden', canCheck);
  callBtn.textContent = toCall >= player.chips
    ? `All-In ${game.formatAmount(player.chips)}`
    : `Call ${game.formatAmount(toCall)}`;
  callBtn.disabled = toCall === 0 && !canCheck;

  syncRaiseControls(game, elements);
}

function renderLog(game, logEl, msgEl) {
  const limit = game.handsRevealed ? 24 : 12;
  logEl.innerHTML = game.handHistory.slice(-limit).map(l => `<div class="log-entry">${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
  if (msgEl._text) msgEl.textContent = msgEl._text;
}

export function setMessage(el, text) {
  el._text = text;
  el.textContent = text;
}
