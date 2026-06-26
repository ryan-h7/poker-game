import { createDeck, shuffle, evaluateHand, compareHands, handName, formatHoleCards } from './engine.js';
import { decideAction, AI_PERSONALITIES } from './ai.js';

const STARTING_CHIPS = 1000;
export const MAX_TABLE_SIZE = 8;
export const MIN_TABLE_SIZE = 2;
export const DEFAULT_STARTING_STACK = 1000;
export const STARTING_STACK_OPTIONS = [500, 1000, 2000, 5000, 10000];
export const BIG_BLIND_OPTIONS = [5, 10, 20, 25, 50, 100];

function createBettingLine() {
  return {
    streets: {},
    barrelCount: 0,
    flopCbetCalled: false,
    turnBarrelCalled: false,
    flopCheckedThrough: false,
  };
}

function cloneCard(c) {
  return { suit: c.suit, rank: c.rank, value: c.value };
}

function cloneCards(cards) {
  return cards.map(cloneCard);
}

export class PokerGame {
  constructor(onUpdate, onMessage) {
    this.onUpdate = onUpdate;
    this.onMessage = onMessage;
    this.playerCount = 4;
    this.bigBlind = 20;
    this.startingStack = DEFAULT_STARTING_STACK;
    this.dealerIndex = 0;
    this.resetPlayers();
    this.phase = 'idle';
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.activeIndex = 0;
    this.lastRaiser = -1;
    this.handHistory = [];
    this.actedThisRound = new Set();
    this.preflopAggressor = -1;
    this.bettingLine = createBettingLine();
    this.humanFoldedPreflop = false;
    this.fastForward = false;
    this.handsRevealed = false;
    this.showBotHandsAtEnd = false;
    this.showInBB = false;
    this.aiTimerId = null;
    this.replaying = false;
    this.lastHandReplay = null;
    this.currentHandEvents = null;
    this.replayIndex = 0;
    this.onlineMode = false;
    this.lobbyPanelOpen = false;
    this.serverMode = false;
    this.localSeatIndex = 0;
    this.isHost = false;
    this._lastMessage = '';
    this.roomMembers = new Map();
  }

  setRoomMembers(members) {
    this.roomMembers = new Map((members || []).map(m => [m.seatIndex, m]));
  }

  getSeatDisplayName(seatIndex) {
    const member = this.roomMembers.get(seatIndex);
    if (member?.name) return member.name;
    return this.players[seatIndex]?.name ?? 'Player';
  }

  getHumanCount() {
    if (this.onlineMode) return this.roomMembers.size;
    return 1;
  }

  getBotCount() {
    return Math.max(0, this.playerCount - this.getHumanCount());
  }

  getMinPlayerCount() {
    return Math.max(MIN_TABLE_SIZE, this.getHumanCount());
  }

  canAddBot() {
    if (!this.canChangeSettings()) return false;
    return this.playerCount < MAX_TABLE_SIZE;
  }

  canRemoveBot() {
    if (!this.canChangeSettings()) return false;
    return this.playerCount > this.getMinPlayerCount();
  }

  addBot() {
    if (!this.canAddBot()) return false;
    return this.setPlayerCount(this.playerCount + 1);
  }

  removeBot() {
    if (!this.canRemoveBot()) return false;
    return this.setPlayerCount(this.playerCount - 1);
  }

  setOnlinePlayers(members, playerCount) {
    this.playerCount = playerCount;
    this.onlineMode = true;
    this.setRoomMembers(members);
    const bySeat = new Map(members.map(m => [m.seatIndex, m]));
    const prev = this.players;
    const inLobby = this.phase === 'idle' || this.phase === 'showdown';
    const stack = this.startingStack ?? DEFAULT_STARTING_STACK;
    this.players = [];
    for (let i = 0; i < playerCount; i++) {
      const member = bySeat.get(i);
      const chips = inLobby ? stack : (prev[i]?.chips ?? stack);
      if (member) {
        this.players.push({
          id: i,
          name: member.name,
          isHuman: true,
          sessionId: member.id,
          chips,
          hole: [],
          bet: 0,
          folded: false,
          inHand: true,
        });
      } else {
        const ai = AI_PERSONALITIES[i % AI_PERSONALITIES.length];
        this.players.push({
          id: i,
          name: ai.name,
          isHuman: false,
          personality: ai,
          chips,
          hole: [],
          bet: 0,
          folded: false,
          inHand: true,
        });
      }
    }
  }

  toNetworkState(viewerSeat) {
    const showHole = (p, i) => {
      if (i === viewerSeat) return cloneCards(p.hole);
      if (this.showBotHandsAtEnd && this.handsRevealed) return cloneCards(p.hole);
      if (this.phase === 'showdown' && !p.folded) return cloneCards(p.hole);
      return [];
    };
    return {
      playerCount: this.playerCount,
      bigBlind: this.bigBlind,
      startingStack: this.startingStack,
      dealerIndex: this.dealerIndex,
      phase: this.phase,
      community: cloneCards(this.community),
      pot: this.pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      activeIndex: this.activeIndex,
      handHistory: [...this.handHistory],
      handsRevealed: this.handsRevealed,
      showBotHandsAtEnd: this.showBotHandsAtEnd,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        isHuman: p.isHuman,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        inHand: p.inHand,
        hole: showHole(p, i),
      })),
      actedThisRound: [...this.actedThisRound],
    };
  }

  applyNetworkState(state) {
    this.onlineMode = true;
    this.localSeatIndex = state.localSeatIndex ?? this.localSeatIndex;
    this.isHost = !!state.isHost;
    this.playerCount = state.playerCount;
    this.bigBlind = state.bigBlind;
    if (state.startingStack) this.startingStack = state.startingStack;
    this.dealerIndex = state.dealerIndex;
    this.phase = state.phase;
    this.community = cloneCards(state.community || []);
    this.pot = state.pot;
    this.currentBet = state.currentBet;
    this.minRaise = state.minRaise;
    this.activeIndex = state.activeIndex;
    this.handHistory = [...(state.handHistory || [])];
    this.handsRevealed = !!state.handsRevealed;
    this.actedThisRound = new Set(state.actedThisRound || []);
    this._lastMessage = state.message || '';
    if (state.members?.length) this.setRoomMembers(state.members);
    this.players = (state.players || []).map((p, i) => {
      const existing = this.players[i];
      const memberName = this.roomMembers.get(i)?.name;
      return {
        id: p.id,
        name: memberName || p.name,
        isHuman: p.isHuman,
        personality: existing?.personality,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        inHand: p.inHand,
        hole: cloneCards(p.hole || []),
      };
    });
    this.onUpdate();
  }

  applyNetworkAction(seatIndex, action, amount = 0) {
    if (this.activeIndex !== seatIndex) return false;
    const player = this.players[seatIndex];
    if (!player?.isHuman) return false;
    const result = this.applyAction(player, action, amount);
    if (!result) return false;
    if (action === 'fold' && this.phase === 'preflop') {
      this.humanFoldedPreflop = true;
    }
    this.actedThisRound.add(seatIndex);
    this.afterAction();
    return true;
  }

  resetPlayers() {
    this.roomMembers = new Map();
    const stack = this.startingStack ?? DEFAULT_STARTING_STACK;
    const aiCount = this.playerCount - 1;
    this.players = [
      { id: 0, name: 'You', isHuman: true, chips: stack, hole: [], bet: 0, folded: false, inHand: true },
      ...Array.from({ length: aiCount }, (_, i) => {
        const p = AI_PERSONALITIES[i % AI_PERSONALITIES.length];
        return {
          id: i + 1, name: p.name, isHuman: false, personality: p,
          chips: stack, hole: [], bet: 0, folded: false, inHand: true,
        };
      }),
    ];
  }

  setPlayerCount(count) {
    if (this.onlineMode) return false;
    if (this.phase !== 'idle' && this.phase !== 'showdown') return false;
    this.playerCount = Math.max(MIN_TABLE_SIZE, Math.min(MAX_TABLE_SIZE, count));
    this.dealerIndex = 0;
    this.community = [];
    this.pot = 0;
    this.handHistory = [];
    this.phase = 'idle';
    this.resetPlayers();
    const bots = this.getBotCount();
    this.onMessage(bots > 0
      ? `Table set to ${this.playerCount} players (${bots} bot${bots === 1 ? '' : 's'}).`
      : `Table set to ${this.playerCount} players.`);
    this.onUpdate();
    return true;
  }

  setStartingStack(amount) {
    if (this.onlineMode) return false;
    if (this.phase !== 'idle' && this.phase !== 'showdown') return false;
    const stack = parseInt(amount, 10);
    if (!Number.isFinite(stack) || stack < 100 || stack > 100000) return false;
    this.startingStack = stack;
    for (const p of this.players) p.chips = stack;
    this.onMessage(`Starting stack set to ${this.formatAmount(stack)}.`);
    this.onUpdate();
    return true;
  }

  setBigBlind(amount) {
    if (this.onlineMode) return false;
    if (this.phase !== 'idle' && this.phase !== 'showdown') return false;
    if (!BIG_BLIND_OPTIONS.includes(amount)) return false;
    this.bigBlind = amount;
    this.minRaise = amount;
    this.onMessage(`Big blind set to ${this.formatAmount(amount)} (small blind ${this.formatAmount(this.getSmallBlind())}).`);
    this.onUpdate();
    return true;
  }

  getSmallBlind() {
    return Math.max(1, Math.floor(this.bigBlind / 2));
  }

  setShowBotHandsAtEnd(enabled) {
    this.showBotHandsAtEnd = enabled;
    if (!enabled) this.handsRevealed = false;
    this.onUpdate();
  }

  setShowInBB(enabled) {
    this.showInBB = enabled;
    this.onUpdate();
  }

  formatAmount(amount) {
    if (!this.showInBB) return `$${amount}`;
    const val = amount / this.bigBlind;
    const text = Math.abs(val - Math.round(val)) < 0.05 ? String(Math.round(val)) : val.toFixed(1);
    return `${text} BB`;
  }

  logRevealedHands() {
    if (!this.showBotHandsAtEnd) return;
    this.handsRevealed = true;
    this.handHistory.push('--- Hands ---');
    for (const p of this.players) {
      if (!p.hole.length) continue;
      const cards = formatHoleCards(p.hole);
      if (this.community.length >= 3) {
        const score = evaluateHand([...p.hole, ...this.community]);
        const suffix = p.folded ? ' (folded)' : '';
        this.handHistory.push(`${p.name}: ${cards} — ${handName(score)}${suffix}`);
      } else {
        const suffix = p.folded ? ' (folded)' : '';
        this.handHistory.push(`${p.name}: ${cards}${suffix}`);
      }
    }
  }

  canChangeSettings() {
    if (this.onlineMode) return this.isHost && (this.phase === 'idle' || this.phase === 'showdown') && !this.replaying;
    return (this.phase === 'idle' || this.phase === 'showdown') && !this.replaying;
  }

  canReplayHand() {
    if (this.onlineMode) return false;
    return !!this.lastHandReplay && this.canChangeSettings();
  }

  captureHandSnapshot() {
    return {
      dealerIndex: this.dealerIndex,
      holes: this.players.map(p => cloneCards(p.hole)),
      deck: cloneCards(this.deck),
      pot: this.pot,
      phase: this.phase,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      activeIndex: this.activeIndex,
      lastRaiser: this.lastRaiser,
      preflopAggressor: this.preflopAggressor,
      community: cloneCards(this.community),
      players: this.players.map(p => ({
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        inHand: p.inHand,
      })),
      bettingLine: JSON.parse(JSON.stringify(this.bettingLine)),
      actedThisRound: [...this.actedThisRound],
      handHistory: [...this.handHistory],
    };
  }

  restoreHandSnapshot(snapshot) {
    this.dealerIndex = snapshot.dealerIndex;
    this.deck = cloneCards(snapshot.deck);
    this.pot = snapshot.pot;
    this.phase = snapshot.phase;
    this.currentBet = snapshot.currentBet;
    this.minRaise = snapshot.minRaise;
    this.activeIndex = snapshot.activeIndex;
    this.lastRaiser = snapshot.lastRaiser;
    this.preflopAggressor = snapshot.preflopAggressor;
    this.community = cloneCards(snapshot.community);
    this.bettingLine = JSON.parse(JSON.stringify(snapshot.bettingLine));
    this.actedThisRound = new Set(snapshot.actedThisRound);
    this.humanFoldedPreflop = false;
    this.fastForward = false;
    this.handsRevealed = false;
    this.handHistory = ['--- Replay ---', ...snapshot.handHistory];
    snapshot.players.forEach((state, i) => {
      const p = this.players[i];
      p.chips = state.chips;
      p.bet = state.bet;
      p.folded = state.folded;
      p.inHand = state.inHand;
      p.hole = cloneCards(snapshot.holes[i]);
    });
  }

  recordEvent(event) {
    if (this.replaying || !this.currentHandEvents) return;
    this.currentHandEvents.push(event);
  }

  finalizeHandRecording(endPhase, endMessage) {
    if (!this.currentHandEvents || !this.handSnapshot) return;
    this.lastHandReplay = {
      snapshot: this.handSnapshot,
      events: [...this.currentHandEvents],
      chipsAfterHand: this.players.map(p => p.chips),
      dealerAfterHand: this.dealerIndex,
      endPhase,
      endMessage,
      endHandHistory: [...this.handHistory],
      endSnapshot: this.captureEndSnapshot(),
    };
    this.currentHandEvents = null;
    this.handSnapshot = null;
  }

  captureEndSnapshot() {
    return {
      phase: this.phase,
      community: cloneCards(this.community),
      pot: this.pot,
      handsRevealed: this.handsRevealed,
      players: this.players.map(p => ({
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        inHand: p.inHand,
        hole: cloneCards(p.hole),
      })),
    };
  }

  applyEndSnapshot(end) {
    this.phase = end.phase;
    this.community = cloneCards(end.community);
    this.pot = end.pot;
    this.handsRevealed = end.handsRevealed;
    end.players.forEach((state, i) => {
      const p = this.players[i];
      p.chips = state.chips;
      p.bet = state.bet;
      p.folded = state.folded;
      p.inHand = state.inHand;
      p.hole = cloneCards(state.hole);
    });
  }

  stopReplay() {
    if (!this.replaying) return;
    this.snapToHandEnd({ stopped: true });
  }

  replayHand() {
    if (!this.canReplayHand()) return;
    this.clearAiTimer();
    this.replaying = true;
    this.restoreHandSnapshot(this.lastHandReplay.snapshot);
    this.replayIndex = 0;
    this.onMessage('Replaying hand…');
    this.onUpdate();
    this.scheduleReplayStep();
  }

  scheduleReplayStep() {
    const delay = this.fastForward ? 0 : 650;
    this.aiTimerId = setTimeout(() => {
      this.aiTimerId = null;
      this.processReplayStep();
    }, delay);
  }

  processReplayStep() {
    if (!this.replaying) return;

    const events = this.lastHandReplay.events;
    if (this.replayIndex >= events.length) {
      this.finishReplayTail();
      return;
    }

    const ev = events[this.replayIndex++];

    if (ev.type === 'phase') {
      this.applyReplayPhase(ev);
      this.onUpdate();
      this.scheduleReplayStep();
      return;
    }

    if (ev.type === 'action') {
      this.activeIndex = ev.playerIndex;
      const player = this.players[ev.playerIndex];
      this.applyAction(player, ev.action, ev.amount ?? 0);
      this.actedThisRound.add(ev.playerIndex);
      this.onUpdate();

      const remaining = this.playersInHand();
      if (remaining.length === 1) {
        this.handHistory.push(`${remaining[0].name} wins ${this.formatAmount(this.pot)} (others folded)`);
        this.snapToHandEnd();
        return;
      }

      if (this.isBettingRoundComplete()) {
        const next = events[this.replayIndex];
        if (next?.type === 'phase') {
          this.scheduleReplayStep();
          return;
        }
        if (this.phase === 'river') {
          this.runReplayShowdown();
          return;
        }
      }

      this.scheduleReplayStep();
    }
  }

  finishReplayTail() {
    if (this.phase === 'river' && this.playersInHand().length > 1) {
      this.runReplayShowdown();
      return;
    }
    this.snapToHandEnd();
  }

  applyReplayPhase(ev) {
    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastRaiser = -1;
    this.actedThisRound = new Set();
    this.community = cloneCards(ev.community);
    this.phase = ev.phase;
    this.bettingLine = createBettingLine();
    this.activeIndex = this.nextActive(this.dealerIndex);
    const labels = { flop: 'Flop', turn: 'Turn', river: 'River' };
    if (labels[ev.phase]) this.handHistory.push(`--- ${labels[ev.phase]} ---`);
  }

  runReplayShowdown() {
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
      remainder--;
      this.handHistory.push(`${w.player.name} wins ${this.formatAmount(award)}`);
    }

    this.snapToHandEnd();
  }

  snapToHandEnd({ stopped = false } = {}) {
    const replay = this.lastHandReplay;
    this.replaying = false;
    this.clearAiTimer();

    if (replay.endSnapshot) {
      this.applyEndSnapshot(replay.endSnapshot);
      this.dealerIndex = replay.dealerAfterHand;
    } else {
      replay.chipsAfterHand.forEach((chips, i) => {
        this.players[i].chips = chips;
        this.players[i].bet = 0;
      });
      this.dealerIndex = replay.dealerAfterHand;
      this.pot = 0;
      this.phase = replay.endPhase;
    }

    if (stopped && replay.endHandHistory) {
      this.handHistory = [...replay.endHandHistory];
    } else if (!stopped) {
      this.logRevealedHands();
    }

    this.onMessage(stopped ? 'Replay stopped.' : (replay.endMessage || 'Replay finished.'));
    this.onUpdate();
  }

  startNewHand() {
    if (this.replaying) return;
    if (this.onlineMode && !this.serverMode) return;
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
    this.minRaise = this.bigBlind;
    this.deck = shuffle(createDeck());
    this.phase = 'preflop';
    this.handHistory = [];
    this.preflopAggressor = -1;
    this.bettingLine = createBettingLine();
    this.humanFoldedPreflop = false;
    this.fastForward = false;
    this.handsRevealed = false;
    this.clearAiTimer();
    this.currentHandEvents = [];
    this.handSnapshot = null;

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

    const sb = this.getSmallBlind();
    const bb = this.bigBlind;

    this.postBlind(sbIndex, Math.min(sb, this.players[sbIndex].chips), 'small blind');
    this.postBlind(bbIndex, Math.min(bb, this.players[bbIndex].chips), 'big blind');

    this.currentBet = bb;
    this.activeIndex = this.nextActive(bbIndex);
    this.lastRaiser = bbIndex;
    this.actedThisRound = new Set();

    this.handSnapshot = this.captureHandSnapshot();
    this.onMessage('New hand dealt.');
    this.onUpdate();
    this.processTurn();
  }

  /** Act for whoever is at activeIndex (no seat advance). */
  processTurn() {
    if (this.replaying) return;

    const remaining = this.playersInHand();
    if (remaining.length === 1) {
      this.awardPot(remaining);
      return;
    }

    if (this.isBettingRoundComplete()) {
      this.nextPhase();
      return;
    }

    let player = this.players[this.activeIndex];
    if (!player?.inHand || player.folded) {
      this.advanceTurn();
      return;
    }

    if (player.isHuman) {
      if (player.folded) {
        this.advanceTurn();
        return;
      }
      this.onUpdate();
      return;
    }

    const delay = this.serverMode ? 450 : (this.fastForward ? 0 : 600 + Math.random() * 800);
    this.clearAiTimer();
    this.aiTimerId = setTimeout(() => {
      this.aiTimerId = null;
      this.executeAiTurn(player);
    }, delay);
  }

  postBlind(index, amount, label) {
    const p = this.players[index];
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.bet = actual;
    this.pot += actual;
    this.handHistory.push(`${p.name} posts ${label} (${this.formatAmount(actual)})`);
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
    if (this.replaying || this.onlineMode) return;
    const player = this.players[this.activeIndex];
    if (!player?.isHuman || this.phase === 'idle' || this.phase === 'showdown') return;

    const result = this.applyAction(player, action, amount);
    if (!result) return;

    if (action === 'fold' && this.phase === 'preflop') {
      this.humanFoldedPreflop = true;
    }

    this.actedThisRound.add(this.activeIndex);
    this.onUpdate();
    this.afterAction();
  }

  canSkipHand() {
    if (this.replaying || this.onlineMode) return false;
    const human = this.getLocalPlayer();
    return !!(
      human?.folded
      && this.humanFoldedPreflop
      && this.phase !== 'idle'
      && this.phase !== 'showdown'
    );
  }

  clearAiTimer() {
    if (this.aiTimerId != null) {
      clearTimeout(this.aiTimerId);
      this.aiTimerId = null;
    }
  }

  skipRemainingHand() {
    if (!this.canSkipHand() || this.fastForward || this.replaying) return;
    this.clearAiTimer();
    this.fastForward = true;
    this.onMessage('Skipping to end of hand…');

    const MAX_STEPS = 600;
    for (let i = 0; i < MAX_STEPS; i++) {
      if (this.phase === 'idle' || this.phase === 'showdown') break;

      const remaining = this.playersInHand();
      if (remaining.length === 1) {
        this.awardPot(remaining);
        break;
      }

      if (this.isBettingRoundComplete()) {
        this.nextPhase();
        continue;
      }

      this.activeIndex = this.nextActive(this.activeIndex);
      const player = this.players[this.activeIndex];
      if (player.isHuman) break;

      this.executeAiTurn(player);
    }

    this.fastForward = false;
    this.onUpdate();
  }

  applyAction(player, action, amount) {
    const toCall = this.currentBet - player.bet;
    const playerIndex = this.players.indexOf(player);
    const succeed = () => {
      if (!this.replaying) {
        this.recordEvent({ type: 'action', playerIndex, action, amount });
      }
      return true;
    };

    switch (action) {
      case 'fold':
        player.folded = true;
        this.handHistory.push(`${player.name} folds`);
        return succeed();

      case 'check':
        if (toCall > 0) return false;
        this.handHistory.push(`${player.name} checks`);
        return succeed();

      case 'call': {
        const pay = Math.min(toCall, player.chips);
        player.chips -= pay;
        player.bet += pay;
        this.pot += pay;
        this.handHistory.push(`${player.name} calls ${this.formatAmount(pay)}`);
        this.noteCallVsAggressor(player);
        return succeed();
      }

      case 'raise': {
        const isFirstBetStreet = this.currentBet === 0 && this.community.length > 0;
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
        if (this.phase === 'preflop') this.preflopAggressor = this.lastRaiser;
        if (isFirstBetStreet) this.noteStreetBet(this.lastRaiser);
        this.handHistory.push(`${player.name} raises to ${this.formatAmount(target)}`);
        return succeed();
      }

      case 'allin': {
        const isFirstBetStreet = this.currentBet === 0 && this.community.length > 0;
        const total = player.chips;
        const newBet = player.bet + total;
        if (newBet > this.currentBet) {
          this.minRaise = Math.max(this.minRaise, newBet - this.currentBet);
          this.currentBet = newBet;
          this.lastRaiser = this.players.indexOf(player);
          this.actedThisRound = new Set([this.lastRaiser]);
          if (this.phase === 'preflop') this.preflopAggressor = this.lastRaiser;
          if (isFirstBetStreet) this.noteStreetBet(this.lastRaiser);
        }
        player.bet = newBet;
        this.pot += total;
        player.chips = 0;
        this.handHistory.push(`${player.name} goes all-in (${this.formatAmount(newBet)})`);
        return succeed();
      }

      default:
        return false;
    }
  }

  advanceTurn() {
    this.activeIndex = this.nextActive(this.activeIndex);
    this.processTurn();
  }

  executeAiTurn(player) {
    if (this.phase === 'idle' || this.phase === 'showdown') return;
    let decision;
    try {
      decision = decideAction(player, this);
    } catch (err) {
      console.error('AI decision error', err);
      const toCall = this.currentBet - player.bet;
      decision = { action: toCall > 0 ? 'fold' : 'check' };
    }
    if (!this.applyAction(player, decision.action, decision.amount ?? 0)) {
      const toCall = this.currentBet - player.bet;
      if (toCall > 0) this.applyAction(player, 'call');
      else this.applyAction(player, 'check');
    } else if (decision.isBluff || decision.isSemiBluff || decision.isCbet || decision.isBarrel) {
      const i = this.handHistory.length - 1;
      if (i >= 0) {
        const tags = [];
        if (decision.isCbet) tags.push('c-bet');
        if (decision.isBarrel) tags.push(`barrel-${decision.barrelStreet || 2}`);
        if (decision.isSemiBluff) tags.push('semi-bluff');
        else if (decision.isBluff) tags.push('bluff');
        if (tags.length) this.handHistory[i] += ` [${tags.join(', ')}]`;
      }
    }
    this.actedThisRound.add(this.activeIndex);
    if (!this.fastForward) this.onUpdate();
    this.afterAction();
  }

  aiTurn(player) {
    this.executeAiTurn(player);
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
    if (this.phase === 'flop' && !this.bettingLine.streets.flop?.bettor) {
      this.bettingLine.flopCheckedThrough = true;
    }

    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
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

    if (!this.replaying) {
      this.recordEvent({
        type: 'phase',
        phase: this.phase,
        community: cloneCards(this.community),
      });
    }

    this.activeIndex = this.nextActive(this.dealerIndex);
    this.onUpdate();
    this.processTurn();
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
      this.handHistory.push(`${w.player.name} wins ${this.formatAmount(award)}`);
    }

    this.pot = 0;
    const endMessage = winners.length > 1
      ? `Split pot! ${winners.map(w => w.player.name).join(' & ')} win.`
      : `${winners[0].player.name} wins with ${handName(winners[0].score)}!`;
    this.onMessage(endMessage);

    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.logRevealedHands();
    this.finalizeHandRecording('showdown', endMessage);
    this.onUpdate();
  }

  awardPot(winners) {
    const share = Math.floor(this.pot / winners.length);
    let remainder = this.pot - share * winners.length;
    for (const w of winners) {
      const award = share + (remainder > 0 ? 1 : 0);
      w.chips += award;
      remainder--;
      this.handHistory.push(`${w.name} wins ${this.formatAmount(award)} (others folded)`);
    }
    const endMessage = `${winners[0].name} wins ${this.formatAmount(share)}!`;
    this.onMessage(endMessage);
    this.pot = 0;
    this.phase = 'idle';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.logRevealedHands();
    this.finalizeHandRecording('idle', endMessage);
    this.onUpdate();
  }

  getHumanPlayer() {
    return this.getLocalPlayer();
  }

  getLocalPlayer() {
    if (this.onlineMode) return this.players[this.localSeatIndex];
    return this.players.find(p => p.isHuman);
  }

  isHumanTurn() {
    if (this.replaying) return false;
    if (this.onlineMode) {
      const p = this.players[this.activeIndex];
      return this.activeIndex === this.localSeatIndex
        && p?.isHuman && !p.folded && p.inHand
        && this.phase !== 'idle' && this.phase !== 'showdown';
    }
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

  /** Total bet (raise-to) for a pot-percentage sized wager. */
  getRaiseFromPotPercent(pct) {
    const p = this.players[this.activeIndex];
    if (!p) return this.getMinRaiseTotal();
    const toCall = this.currentBet - p.bet;
    const minTotal = this.getMinRaiseTotal();
    const maxTotal = p.bet + p.chips;

    let target;
    if (toCall === 0) {
      const wager = Math.max(this.bigBlind, Math.floor(this.pot * pct));
      target = p.bet + wager;
    } else {
      const potAfterCall = this.pot + toCall;
      const raiseBy = Math.max(this.minRaise, Math.floor(potAfterCall * pct));
      target = p.bet + toCall + raiseBy;
    }
    return Math.min(maxTotal, Math.max(minTotal, target));
  }

  clampRaiseTotal(amount) {
    const p = this.players[this.activeIndex];
    if (!p) return amount;
    const minTotal = this.getMinRaiseTotal();
    const maxTotal = p.bet + p.chips;
    return Math.min(maxTotal, Math.max(minTotal, Math.floor(amount)));
  }

  noteStreetBet(playerIndex) {
    const street = this.phase;
    this.bettingLine.streets[street] = { bettor: playerIndex };
    if (playerIndex === this.preflopAggressor) {
      this.bettingLine.barrelCount += 1;
    }
  }

  noteCallVsAggressor(player) {
    const street = this.phase;
    const bettor = this.bettingLine.streets[street]?.bettor;
    if (bettor === this.preflopAggressor && player !== this.players[bettor]) {
      if (street === 'flop') this.bettingLine.flopCbetCalled = true;
      if (street === 'turn') this.bettingLine.turnBarrelCalled = true;
    }
  }
}
