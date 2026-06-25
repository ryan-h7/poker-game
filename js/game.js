import { createDeck, shuffle, evaluateHand, compareHands, handName } from './engine.js';
import { decideAction, AI_PERSONALITIES } from './ai.js';

const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

export class PokerGame {
  constructor(onUpdate, onMessage) {
    this.onUpdate = onUpdate;
    this.onMessage = onMessage;
    this.dealerIndex = 0;
    this.resetPlayers();
    this.phase = 'idle';
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.activeIndex = 0;
    this.lastRaiser = -1;
    this.handHistory = [];
    this.actedThisRound = new Set();
  }

  resetPlayers() {
    this.players = [
      { id: 0, name: 'You', isHuman: true, chips: STARTING_CHIPS, hole: [], bet: 0, folded: false, inHand: true },
      ...AI_PERSONALITIES.map((p, i) => ({
        id: i + 1, name: p.name, isHuman: false, personality: p,
        chips: STARTING_CHIPS, hole: [], bet: 0, folded: false, inHand: true,
      })),
    ];
  }

  startNewHand() {
    const active = this.players.filter(p => p.chips > 0);
    if (active.length < 2) {
      this.onMessage('Game over! Not enough players with chips.');
      return;
    }

    for (const p of this.players) {
      p.hole = [];
      p.bet = 0;
      p.folded = p.chips <= 0;
      p.inHand = p.chips > 0;
    }

    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.deck = shuffle(createDeck());
    this.phase = 'preflop';
    this.handHistory = [];

    while (!this.players[this.dealerIndex].inHand) {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    }

    for (let i = 0; i < 2; i++) {
      for (const p of this.players) {
        if (p.inHand) p.hole.push(this.deck.pop());
      }
    }

    const sbIndex = this.nextActive(this.dealerIndex);
    const bbIndex = this.nextActive(sbIndex);

    this.postBlind(sbIndex, Math.min(SMALL_BLIND, this.players[sbIndex].chips), 'small blind');
    this.postBlind(bbIndex, Math.min(BIG_BLIND, this.players[bbIndex].chips), 'big blind');

    this.currentBet = BIG_BLIND;
    this.activeIndex = this.nextActive(bbIndex);
    this.lastRaiser = bbIndex;
    this.actedThisRound = new Set();

    this.onMessage('New hand dealt.');
    this.onUpdate();
    this.advanceTurn();
  }

  postBlind(index, amount, label) {
    const p = this.players[index];
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.bet = actual;
    this.pot += actual;
    this.handHistory.push(`${p.name} posts ${label} (${actual})`);
  }

  nextActive(from) {
    let i = (from + 1) % this.players.length;
    let count = 0;
    while ((!this.players[i].inHand || this.players[i].folded) && count < this.players.length) {
      i = (i + 1) % this.players.length;
      count++;
    }
    return i;
  }

  playersInHand() {
    return this.players.filter(p => p.inHand && !p.folded);
  }

  humanAction(action, amount = 0) {
    const player = this.players[this.activeIndex];
    if (!player?.isHuman || this.phase === 'idle' || this.phase === 'showdown') return;

    const result = this.applyAction(player, action, amount);
    if (!result) return;

    this.actedThisRound.add(this.activeIndex);
    this.onUpdate();
    this.afterAction();
  }

  applyAction(player, action, amount) {
    const toCall = this.currentBet - player.bet;

    switch (action) {
      case 'fold':
        player.folded = true;
        this.handHistory.push(`${player.name} folds`);
        return true;

      case 'check':
        if (toCall > 0) return false;
        this.handHistory.push(`${player.name} checks`);
        return true;

      case 'call': {
        const pay = Math.min(toCall, player.chips);
        player.chips -= pay;
        player.bet += pay;
        this.pot += pay;
        this.handHistory.push(`${player.name} calls ${pay}`);
        return true;
      }

      case 'raise': {
        const target = Math.max(amount, this.currentBet + this.minRaise);
        const total = target - player.bet;
        if (total > player.chips) return false;
        const raiseBy = target - this.currentBet;
        if (raiseBy < this.minRaise && target < player.bet + player.chips) return false;
        player.chips -= total;
        player.bet = target;
        this.pot += total;
        this.minRaise = Math.max(this.minRaise, raiseBy);
        this.currentBet = target;
        this.lastRaiser = this.players.indexOf(player);
        this.actedThisRound = new Set([this.lastRaiser]);
        this.handHistory.push(`${player.name} raises to ${target}`);
        return true;
      }

      case 'allin': {
        const total = player.chips;
        const newBet = player.bet + total;
        if (newBet > this.currentBet) {
          this.minRaise = Math.max(this.minRaise, newBet - this.currentBet);
          this.currentBet = newBet;
          this.lastRaiser = this.players.indexOf(player);
          this.actedThisRound = new Set([this.lastRaiser]);
        }
        player.bet = newBet;
        this.pot += total;
        player.chips = 0;
        this.handHistory.push(`${player.name} goes all-in (${newBet})`);
        return true;
      }

      default:
        return false;
    }
  }

  advanceTurn() {
    const remaining = this.playersInHand();
    if (remaining.length === 1) {
      this.awardPot(remaining);
      return;
    }

    if (this.isBettingRoundComplete()) {
      this.nextPhase();
      return;
    }

    this.activeIndex = this.nextActive(this.activeIndex);
    const player = this.players[this.activeIndex];

    if (player.isHuman) {
      this.onUpdate();
      return;
    }

    setTimeout(() => this.aiTurn(player), 600 + Math.random() * 800);
  }

  aiTurn(player) {
    if (this.phase === 'idle' || this.phase === 'showdown') return;
    const decision = decideAction(player, this);
    if (!this.applyAction(player, decision.action, decision.amount ?? 0)) return;
    this.actedThisRound.add(this.activeIndex);
    this.onUpdate();
    this.afterAction();
  }

  isBettingRoundComplete() {
    const inHand = this.players.filter(p => p.inHand && !p.folded);
    if (inHand.length <= 1) return true;

    const canAct = inHand.filter(p => p.chips > 0);
    if (canAct.every(p => p.bet === this.currentBet)) {
      const needsAction = canAct.filter(p => !this.actedThisRound.has(this.players.indexOf(p)));
      if (needsAction.length === 0) return true;
    }
    return false;
  }

  findBigBlindIndex() {
    let idx = this.nextActive(this.dealerIndex);
    return this.nextActive(idx);
  }

  afterAction() {
    const remaining = this.playersInHand();
    if (remaining.length === 1) {
      this.awardPot(remaining);
      return;
    }
    this.advanceTurn();
  }

  nextPhase() {
    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.lastRaiser = -1;
    this.actedThisRound = new Set();

    const stillIn = this.players.filter(p => p.inHand && !p.folded);

    if (stillIn.length === 1) {
      this.awardPot(stillIn);
      return;
    }

    const phases = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const idx = phases.indexOf(this.phase);

    if (this.phase === 'preflop') {
      this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.phase = 'flop';
      this.handHistory.push('--- Flop ---');
    } else if (this.phase === 'flop') {
      this.community.push(this.deck.pop());
      this.phase = 'turn';
      this.handHistory.push('--- Turn ---');
    } else if (this.phase === 'turn') {
      this.community.push(this.deck.pop());
      this.phase = 'river';
      this.handHistory.push('--- River ---');
    } else if (this.phase === 'river') {
      this.showdown();
      return;
    }

    this.activeIndex = this.nextActive(this.dealerIndex);
    this.onUpdate();
    this.advanceTurn();
  }

  showdown() {
    this.phase = 'showdown';
    const contenders = this.players.filter(p => p.inHand && !p.folded);
    const results = contenders.map(p => ({
      player: p,
      score: evaluateHand([...p.hole, ...this.community]),
    }));

    results.sort((a, b) => compareHands(b.score, a.score));
    const best = results[0].score;
    const winners = results.filter(r => compareHands(r.score, best) === 0);

    for (const w of winners) {
      this.handHistory.push(`${w.player.name} shows ${handName(w.score)}`);
    }

    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const w of winners) {
      const award = share + (remainder > 0 ? 1 : 0);
      w.player.chips += award;
      remainder--;
      this.handHistory.push(`${w.player.name} wins ${award}`);
    }

    this.pot = 0;
    this.onMessage(winners.length > 1
      ? `Split pot! ${winners.map(w => w.player.name).join(' & ')} win.`
      : `${winners[0].player.name} wins with ${handName(winners[0].score)}!`);

    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.onUpdate();
  }

  awardPot(winners) {
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const w of winners) {
      const award = share + (remainder > 0 ? 1 : 0);
      w.chips += award;
      remainder--;
      this.handHistory.push(`${w.name} wins ${award} (others folded)`);
    }
    this.onMessage(`${winners[0].name} wins ${share}!`);
    this.pot = 0;
    this.phase = 'idle';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.onUpdate();
  }

  getHumanPlayer() {
    return this.players.find(p => p.isHuman);
  }

  isHumanTurn() {
    const p = this.players[this.activeIndex];
    return p?.isHuman && !p.folded && p.inHand && this.phase !== 'idle' && this.phase !== 'showdown';
  }

  getCallAmount() {
    const p = this.players[this.activeIndex];
    if (!p) return 0;
    return Math.min(this.currentBet - p.bet, p.chips);
  }

  getMinRaiseTotal() {
    const p = this.players[this.activeIndex];
    if (!p) return this.currentBet + this.minRaise;
    return this.currentBet + this.minRaise;
  }
}
