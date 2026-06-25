import { SUIT_COLORS } from './engine.js';

const SEAT_POSITIONS = [
  { bottom: '8%', left: '50%', transform: 'translateX(-50%)' },
  { top: '18%', left: '12%' },
  { top: '8%', left: '50%', transform: 'translateX(-50%)' },
  { top: '18%', right: '12%' },
];

export function renderGame(game, elements) {
  renderCommunity(game, elements.community);
  renderPlayers(game, elements.seats);
  renderPot(game, elements.pot);
  renderControls(game, elements);
  renderLog(game, elements.log, elements.message);
  renderPhase(game, elements.phase);
}

function cardHTML(card, hidden = false) {
  if (hidden) {
    return `<div class="card card-back"><span class="card-back-pattern"></span></div>`;
  }
  const color = SUIT_COLORS[card.suit];
  return `<div class="card ${color}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
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
    const pos = SEAT_POSITIONS[i];
    const style = Object.entries(pos).map(([k, v]) => `${k}: ${v}`).join(';');
    const isActive = game.players[game.activeIndex]?.id === p.id &&
      game.phase !== 'idle' && game.phase !== 'showdown';
    const isDealer = i === game.dealerIndex;
    const showCards = p.isHuman || game.phase === 'showdown';
    const folded = p.folded;

    const cards = p.hole.length
      ? p.hole.map(c => cardHTML(c, !showCards || folded)).join('')
      : '<div class="card card-empty"></div><div class="card card-empty"></div>';

    return `<div class="player-seat ${isActive ? 'active' : ''} ${folded ? 'folded' : ''}" style="${style}">
      ${isDealer ? '<span class="dealer-button">D</span>' : ''}
      <div class="player-cards">${cards}</div>
      <div class="player-info">
        <span class="player-name">${p.name}</span>
        <span class="player-chips">$${p.chips}</span>
        ${p.bet > 0 ? `<span class="player-bet">Bet: $${p.bet}</span>` : ''}
        ${folded ? '<span class="player-status">Folded</span>' : ''}
        ${p.chips === 0 && p.inHand && !p.folded ? '<span class="player-status allin">All-In</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

function renderPot(game, el) {
  el.textContent = game.pot > 0 ? `Pot: $${game.pot}` : '';
}

function renderPhase(game, el) {
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
  const { controls, foldBtn, checkBtn, callBtn, raiseBtn, raiseSlider, raiseValue, newHandBtn } = elements;
  const human = game.getHumanPlayer();
  const isTurn = game.isHumanTurn();

  if (game.phase === 'idle' || game.phase === 'showdown') {
    controls.classList.add('hidden');
    newHandBtn.classList.remove('hidden');
    newHandBtn.disabled = game.players.filter(p => p.chips > 0).length < 2;
    return;
  }

  newHandBtn.classList.add('hidden');
  controls.classList.toggle('hidden', !isTurn);

  if (!isTurn) return;

  const player = game.players[game.activeIndex];
  const toCall = game.getCallAmount();
  const canCheck = toCall === 0;

  foldBtn.disabled = false;
  checkBtn.disabled = !canCheck;
  checkBtn.classList.toggle('hidden', !canCheck);
  callBtn.classList.toggle('hidden', canCheck);
  callBtn.textContent = toCall >= player.chips ? `All-In $${player.chips}` : `Call $${toCall}`;
  callBtn.disabled = toCall === 0 && !canCheck;

  const minRaise = game.getMinRaiseTotal();
  const maxRaise = player.bet + player.chips;
  raiseSlider.min = minRaise;
  raiseSlider.max = maxRaise;
  raiseSlider.value = Math.min(minRaise + 20, maxRaise);
  raiseValue.textContent = raiseSlider.value;
  raiseBtn.disabled = maxRaise <= game.currentBet;
}

function renderLog(game, logEl, msgEl) {
  logEl.innerHTML = game.handHistory.slice(-12).map(l => `<div class="log-entry">${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
  if (msgEl._text) msgEl.textContent = msgEl._text;
}

export function setMessage(el, text) {
  el._text = text;
  el.textContent = text;
}
