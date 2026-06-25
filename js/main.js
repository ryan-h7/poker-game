import { PokerGame } from './game.js';
import { renderGame, setMessage } from './ui.js';

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
  raiseValue: document.getElementById('raise-value'),
  newHandBtn: document.getElementById('btn-new-hand'),
};

const game = new PokerGame(
  () => renderGame(game, elements),
  (msg) => setMessage(elements.message, msg),
);

elements.newHandBtn.addEventListener('click', () => game.startNewHand());

elements.foldBtn.addEventListener('click', () => game.humanAction('fold'));
elements.checkBtn.addEventListener('click', () => game.humanAction('check'));
elements.callBtn.addEventListener('click', () => {
  const player = game.players[game.activeIndex];
  const toCall = game.getCallAmount();
  if (toCall >= player.chips) game.humanAction('allin');
  else game.humanAction('call');
});

elements.raiseSlider.addEventListener('input', (e) => {
  elements.raiseValue.textContent = e.target.value;
});

elements.raiseBtn.addEventListener('click', () => {
  const amount = parseInt(elements.raiseSlider.value, 10);
  const player = game.players[game.activeIndex];
  if (amount >= player.bet + player.chips) game.humanAction('allin');
  else game.humanAction('raise', amount);
});

renderGame(game, elements);
setMessage(elements.message, 'Click "Deal Hand" to start playing Texas Hold\'em!');
