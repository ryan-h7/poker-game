import {
  evaluateHand, compareHands, classifyHand, boardTexture,
} from './engine.js';

export function getPositionTier(playerIndex, dealerIndex, totalPlayers) {
  const afterBtn = (playerIndex - dealerIndex + totalPlayers) % totalPlayers;
  if (afterBtn === 0) return 'btn';
  if (totalPlayers <= 3) return afterBtn === 1 ? 'early' : 'late';
  if (afterBtn <= 2) return 'early';
  if (afterBtn >= totalPlayers - 1) return 'late';
  return 'middle';
}

const POSITION = {
  early:  { strengthAdj: 0.1,  bluffMult: 0.35, openThreshold: 0.78 },
  middle: { strengthAdj: 0.04,  bluffMult: 0.7,  openThreshold: 0.72 },
  late:   { strengthAdj: -0.05, bluffMult: 1.35, openThreshold: 0.65 },
  btn:    { strengthAdj: -0.1,  bluffMult: 1.9,  openThreshold: 0.58 },
};

const SIZE_REACTION = {
  small:   { strengthPenalty: -0.05, callBonus: 0.08, reraiseExtra: -0.05, stackFoldMult: 1.25 },
  medium:  { strengthPenalty: 0,     callBonus: 0,     reraiseExtra: 0,     stackFoldMult: 1.0 },
  large:   { strengthPenalty: 0.1,   callBonus: -0.1,  reraiseExtra: 0.12,  stackFoldMult: 0.65 },
  overbet: { strengthPenalty: 0.2,   callBonus: -0.16, reraiseExtra: 0.22,  stackFoldMult: 0.45 },
};

const CBET_FREQ = {
  'dry-high': 0.72, 'dry-low': 0.66, neutral: 0.56, paired: 0.38, wet: 0.3,
};

/** Players still in the hand + callers / players behind for cold-call pressure. */
export function getPotContext(game, playerIndex) {
  const inPot = game.players.filter(p => p.inHand && !p.folded);
  const playersInPot = inPot.length;
  const isMultiway = playersInPot >= 3;
  const isHeadsUp = playersInPot === 2;

  const callers = inPot.filter((p) => {
    const i = game.players.indexOf(p);
    return i !== playerIndex && p.bet === game.currentBet && game.currentBet > 0;
  }).length;

  let playersBehind = 0;
  let i = playerIndex;
  for (let step = 0; step < game.players.length; step++) {
    i = (i + 1) % game.players.length;
    if (i === playerIndex) break;
    const p = game.players[i];
    if (!p.inHand || p.folded) continue;
    if (!game.actedThisRound.has(i)) playersBehind++;
  }

  const coldCallPressure = callers + playersBehind;

  let multiwayScalar = 1;
  if (playersInPot === 3) multiwayScalar = 0.6;
  else if (playersInPot === 4) multiwayScalar = 0.45;
  else if (playersInPot >= 5) multiwayScalar = 0.32;

  return {
    playersInPot,
    isMultiway,
    isHeadsUp,
    callers,
    playersBehind,
    coldCallPressure,
    multiwayScalar,
  };
}

function coldCallTightness(pressure) {
  if (pressure <= 0) return 1;
  if (pressure === 1) return 0.78;
  if (pressure === 2) return 0.58;
  return 0.42;
}

export const PREFLOP_RANGES = {
  early: { open: 'TT+, AQs+, AKo', call: '77–99, AJs, KQs', fold: 'Weak offsuit' },
  middle: { open: '88+, ATs+, AJo+, KQs', call: '55–77, suited connectors', fold: 'Low pairs OOP' },
  late: { open: '55+, A8s+, ATo+, KJo+', call: 'Pairs, suited aces', fold: 'Trash offsuit' },
  btn: { open: '22+, A2s+, A9o+, broadways', call: 'Very wide', fold: '72o-type trash' },
};

export function getFacingBetAnalysis(game, player) {
  const toCall = game.currentBet - player.bet;
  if (toCall <= 0) {
    return { facing: false, sizeCategory: 'none', ...SIZE_REACTION.medium };
  }

  const bb = game.bigBlind;
  const pot = Math.max(game.pot, bb);
  const isPreflop = game.community.length === 0;
  const betPotRatio = toCall / pot;
  const openBB = game.currentBet / bb;

  let sizeCategory;
  if (isPreflop) {
    if (openBB <= 2.5) sizeCategory = 'small';
    else if (openBB <= 4) sizeCategory = 'medium';
    else if (openBB <= 8) sizeCategory = 'large';
    else sizeCategory = 'overbet';
  } else {
    if (betPotRatio < 0.35) sizeCategory = 'small';
    else if (betPotRatio < 0.65) sizeCategory = 'medium';
    else if (betPotRatio < 1.0) sizeCategory = 'large';
    else sizeCategory = 'overbet';
  }

  const base = { ...SIZE_REACTION[sizeCategory] };
  let reraiseExtra = base.reraiseExtra;
  if (isPreflop) {
    if (openBB >= 8) reraiseExtra += 0.12;
    if (openBB >= 15) reraiseExtra += 0.15;
  } else if (sizeCategory === 'overbet' && betPotRatio > 1.5) {
    reraiseExtra += 0.1;
  }

  return { facing: true, sizeCategory, betPotRatio, openBB, toCall, ...base, reraiseExtra };
}

/** Spots where pre-flop aggressor leads with a bet (c-bet / barrel). */
export function getBarrelContext(game, playerIndex) {
  const pa = game.preflopAggressor;
  const isAggressor = playerIndex === pa && pa >= 0;
  const line = game.bettingLine;
  const phase = game.phase;
  const streetBettor = line.streets[phase]?.bettor;
  const toCall = game.currentBet - game.players[playerIndex].bet;
  const checkedTo = toCall === 0;

  const isCbetSpot = phase === 'flop' && isAggressor && checkedTo && streetBettor === undefined;
  const isTurnBarrelSpot = phase === 'turn' && isAggressor && checkedTo && streetBettor === undefined
    && line.streets.flop?.bettor === pa && line.flopCbetCalled;
  const isRiverBarrelSpot = phase === 'river' && isAggressor && checkedTo && streetBettor === undefined
    && line.streets.turn?.bettor === pa && line.turnBarrelCalled;

  return {
    isAggressor,
    isCbetSpot,
    isTurnBarrelSpot,
    isRiverBarrelSpot,
    texture: boardTexture(game.community),
    barrelCount: line.barrelCount,
  };
}

function decideCbetOrBarrel(player, game, hand, aggression, barrelCtx, potCtx) {
  const toCall = game.currentBet - player.bet;
  if (toCall > 0) return null;

  const mw = potCtx.multiwayScalar;

  const betForStreet = (street) => {
    const frac = street === 'flop'
      ? 0.33 + aggression * 0.2
      : street === 'turn'
        ? 0.55 + aggression * 0.15
        : 0.62 + aggression * 0.18;
    return Math.min(player.chips, Math.max(game.minRaise, Math.floor(game.pot * frac)));
  };

  const makeBet = (amt, meta) => ({
    action: 'raise',
    amount: player.bet + amt,
    ...meta,
  });

  // ── Flop c-bet ──
  if (barrelCtx.isCbetSpot) {
    const baseFreq = CBET_FREQ[barrelCtx.texture] ?? 0.5;
    const freq = baseFreq * (0.75 + aggression * 0.35) * mw;

    if (hand.category === 'premium') {
      const amt = betForStreet('flop');
      if (amt > 0) return makeBet(amt, { isCbet: true });
    }
    if (hand.category === 'marginal') {
      const valueCbet = potCtx.isMultiway
        ? 0.3 + aggression * 0.22
        : 0.82 + aggression * 0.12;
      if (Math.random() < valueCbet) {
        const amt = betForStreet('flop');
        if (amt > 0) return makeBet(amt, { isCbet: true });
      }
      return { action: 'check' };
    }
    if (hand.category === 'draw' && Math.random() < 0.72 * mw) {
      const amt = betForStreet('flop');
      if (amt > 0) return makeBet(amt, { isCbet: true, isSemiBluff: true });
    }
    if (hand.category === 'air' && Math.random() < freq * 0.55) {
      const amt = betForStreet('flop');
      if (amt > 0) return makeBet(amt, { isCbet: true, isBluff: true });
    }
    if (potCtx.isMultiway) return { action: 'check' };
  }

  // ── Turn barrel (fired flop c-bet and got called) ──
  if (barrelCtx.isTurnBarrelSpot) {
    const dryBonus = ['dry-high', 'dry-low', 'neutral'].includes(barrelCtx.texture) ? 1.2 : 0.75;
    const barrelFreq = (0.38 + aggression * 0.28) * dryBonus * mw;

    if (hand.category === 'premium') {
      const amt = betForStreet('turn');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2 });
    }
    if (hand.category === 'marginal' && Math.random() < (0.55 + aggression * 0.2) * mw) {
      const amt = betForStreet('turn');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2 });
    }
    if (hand.category === 'draw' && Math.random() < barrelFreq * 0.65) {
      const amt = betForStreet('turn');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2, isSemiBluff: true });
    }
    if (hand.category === 'air' && Math.random() < barrelFreq * 0.35) {
      const amt = betForStreet('turn');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2, isBluff: true });
    }
    return { action: 'check' };
  }

  // ── River triple barrel (polarized) ──
  if (barrelCtx.isRiverBarrelSpot) {
    const tripleFreq = (0.14 + aggression * 0.18) * mw;

    if (hand.category === 'premium' || (hand.category === 'marginal' && hand.strength > 0.28)) {
      const amt = betForStreet('river');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 3 });
    }
    if (hand.category === 'air' && Math.random() < tripleFreq) {
      const amt = betForStreet('river');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 3, isBluff: true });
    }
    return { action: 'check' };
  }

  return null;
}

/** Defender vs c-bet / barrel. */
function decideVsBarrel(player, game, hand, aggression, facing, barrelCtx, potCtx) {
  const toCall = game.currentBet - player.bet;
  if (toCall <= 0) return null;

  const pa = game.preflopAggressor;
  const bettor = game.bettingLine.streets[game.phase]?.bettor;
  const facingAggressorBarrel = bettor === pa && pa >= 0 && game.players.indexOf(player) !== pa;
  if (!facingAggressorBarrel) return null;

  const isCbet = game.phase === 'flop' && game.bettingLine.barrelCount === 1;
  const isBarrel = game.phase === 'turn' || game.phase === 'river';
  const mwFoldBias = potCtx.isMultiway ? 0.12 : 0;

  if (hand.category === 'premium') return { action: 'call' };
  if (hand.category === 'draw') {
    const potOdds = toCall / (game.pot + toCall);
    const need = 0.32 + hand.draws.drawStrength * 0.2 + mwFoldBias;
    if (potOdds < need) return { action: 'call' };
    if (isBarrel && facing.sizeCategory === 'large') return { action: 'fold' };
    if (potCtx.isMultiway && facing.sizeCategory !== 'small') return { action: 'fold' };
    return { action: 'call' };
  }
  if (hand.category === 'marginal') {
    if (isCbet && facing.sizeCategory === 'small' && !potCtx.isMultiway) return { action: 'call' };
    if (isCbet && potCtx.isMultiway && facing.sizeCategory === 'small' && Math.random() < 0.45) {
      return { action: 'call' };
    }
    if (isBarrel && facing.sizeCategory !== 'small' && Math.random() > aggression * 0.5) {
      return { action: 'fold' };
    }
    const potOdds = toCall / (game.pot + toCall);
    if (potOdds < 0.28) return { action: 'call' };
    return { action: 'fold' };
  }
  // air vs barrel — occasional hero call on small c-bet
  if (isCbet && facing.sizeCategory === 'small' && Math.random() < 0.12 * (1 - aggression)) {
    return { action: 'call' };
  }
  return { action: 'fold' };
}

export function decideAction(player, game) {
  const toCall = game.currentBet - player.bet;
  const canCheck = toCall === 0;
  const potOdds = toCall > 0 ? toCall / (game.pot + toCall) : 0;
  const isPreflop = game.community.length === 0;
  const facing = getFacingBetAnalysis(game, player);

  const playerIndex = game.players.indexOf(player);
  const posTier = getPositionTier(playerIndex, game.dealerIndex, game.players.length);
  const pos = POSITION[posTier];
  const barrelCtx = getBarrelContext(game, playerIndex);
  const potCtx = getPotContext(game, playerIndex);

  const hand = classifyHand(player.hole, game.community);
  let strength = hand.strength;

  if (!isPreflop) {
    const maxOpp = estimateOpponentStrength(game, player);
    const score = hand.made || evaluateHand([...player.hole, ...game.community]);
    strength = strength * 0.65 + (compareHands(score, maxOpp) > 0 ? 0.25 : 0);
    if (hand.category === 'draw') strength += hand.draws.drawStrength * 0.15;
  }

  const aggression = player.personality?.aggression ?? 0.5;

  // C-bet / barrel lines for pre-flop aggressor
  if (!isPreflop) {
    const barrelAction = decideCbetOrBarrel(player, game, hand, aggression, barrelCtx, potCtx);
    if (barrelAction) return barrelAction;

    const defendAction = decideVsBarrel(player, game, hand, aggression, facing, barrelCtx, potCtx);
    if (defendAction) return defendAction;
  }

  let effectiveStrength = strength - pos.strengthAdj;
  if (facing.facing) {
    effectiveStrength -= facing.strengthPenalty;
    effectiveStrength -= potCtx.callers * 0.04;
    effectiveStrength -= potCtx.playersBehind * 0.035;
    if (!isPreflop && potCtx.isMultiway) effectiveStrength -= 0.03;
  }

  const bluffRoll = Math.random() < 0.14 * aggression * pos.bluffMult * potCtx.multiwayScalar
    * (facing.sizeCategory === 'overbet' ? 0.25 : facing.sizeCategory === 'large' ? 0.5 : 1);

  const raiseSize = () => {
    const potFactor = facing.facing && facing.sizeCategory === 'small'
      ? 0.55 + aggression * 0.45
      : 0.45 + aggression * 0.55;
    return Math.min(player.chips, Math.max(game.minRaise, Math.floor(game.pot * potFactor)));
  };

  const tryRaise = (isBluff, isSemiBluff = false) => {
    const amt = raiseSize();
    if (amt > 0 && player.chips > 0 && (canCheck ? true : amt > toCall && player.chips > toCall)) {
      return {
        action: 'raise',
        amount: player.bet + (canCheck ? amt : Math.min(amt, player.chips)),
        isBluff,
        isSemiBluff,
      };
    }
    return null;
  };

  if (hand.category === 'premium') {
    const valueThreshold = pos.openThreshold - aggression * 0.05 + facing.reraiseExtra;
    if (effectiveStrength > valueThreshold) {
      const canReraise = !facing.facing || effectiveStrength > valueThreshold + 0.06
        || facing.sizeCategory === 'small';
      const raised = canReraise ? tryRaise(false) : null;
      if (raised) return raised;
      if (!canCheck) return { action: 'call' };
      return { action: 'check' };
    }
  }

  if (hand.category === 'draw') {
    const drawPower = hand.draws.drawStrength;
    const semiBluffFreq = (0.28 + aggression * 0.35) * potCtx.multiwayScalar;
    const canSemiBluff = canCheck && posTier !== 'early' && !barrelCtx.isAggressor
      && !potCtx.isMultiway
      && (!facing.facing || facing.sizeCategory === 'small' || facing.sizeCategory === 'medium');

    if (canSemiBluff && Math.random() < semiBluffFreq) {
      const raised = tryRaise(false, true);
      if (raised) return raised;
    }

    if (!canCheck) {
      const cold = coldCallTightness(potCtx.coldCallPressure);
      const drawPotOdds = (0.28 + drawPower * 0.25 - (facing.sizeCategory === 'small' ? 0.06 : 0)) * cold;
      const stackCap = (0.28 + drawPower * 0.2) * cold;
      if (potOdds <= drawPotOdds && toCall <= player.chips * stackCap) {
        return { action: 'call' };
      }
      if (facing.sizeCategory === 'overbet') return { action: 'fold' };
      if (facing.sizeCategory === 'large' && drawPower < 0.5) return { action: 'fold' };
      if (toCall <= player.chips * 0.15) return { action: 'call' };
      return { action: 'fold' };
    }
    return { action: 'check' };
  }

  if (facing.facing && (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet')) {
    const continueThreshold = 0.55 + facing.reraiseExtra + (posTier === 'early' ? 0.08 : 0);
    if (effectiveStrength < continueThreshold) {
      if (hand.category === 'marginal' && potOdds < 0.2 && facing.sizeCategory !== 'overbet') {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }
  }

  if (hand.category === 'air') {
    if (bluffRoll && canCheck && posTier !== 'early' && !barrelCtx.isAggressor
        && !potCtx.isMultiway
        && (!facing.facing || facing.sizeCategory === 'small')) {
      const raised = tryRaise(true);
      if (raised) return raised;
    }
    if (canCheck) return { action: 'check' };
    if (toCall <= game.bigBlind && facing.sizeCategory === 'small') return { action: 'call' };
    return { action: 'fold' };
  }

  if (hand.category === 'speculative' && isPreflop) {
    const limpedPot = potCtx.callers >= 1;
    if (bluffRoll && canCheck && (posTier === 'late' || posTier === 'btn') && !limpedPot) {
      const raised = tryRaise(true);
      if (raised) return raised;
    }
    if (!canCheck) {
      const cold = coldCallTightness(potCtx.coldCallPressure);
      let maxBB = (posTier === 'late' || posTier === 'btn') ? 2.5 : 1.5;
      maxBB *= cold;
      if (potCtx.coldCallPressure >= 2 && posTier !== 'btn') return { action: 'fold' };
      if (toCall <= game.bigBlind * maxBB && (posTier === 'late' || posTier === 'btn' || cold >= 0.7)) {
        return { action: 'call' };
      }
      return { action: 'fold' };
    }
    return { action: 'check' };
  }

  if (hand.category === 'marginal') {
    if (canCheck) {
      if (bluffRoll && posTier !== 'early' && !barrelCtx.isAggressor && !potCtx.isMultiway
          && Math.random() < aggression * 0.2) {
        const raised = tryRaise(true);
        if (raised) return raised;
      }
      return { action: 'check' };
    }
    const cold = coldCallTightness(potCtx.coldCallPressure);
    let callLimit = ((posTier === 'early' ? 0.2 : 0.3) + facing.callBonus) * cold;
    if (facing.sizeCategory === 'small') callLimit += 0.06 * cold;
    if (potCtx.coldCallPressure >= 2 && hand.strength < 0.5) return { action: 'fold' };
    if (potOdds < 0.3 * cold && toCall <= player.chips * callLimit) return { action: 'call' };
    if (toCall <= game.bigBlind * 2 * cold && facing.sizeCategory !== 'overbet') return { action: 'call' };
    return { action: 'fold' };
  }

  if (canCheck) return { action: 'check' };
  if (toCall <= player.chips * 0.2) return { action: 'call' };
  return { action: 'fold' };
}

function estimateOpponentStrength(game, self) {
  let best = { rank: 0, kickers: [0] };
  for (const p of game.players) {
    if (p === self || !p.inHand || p.folded) continue;
    if (game.community.length >= 3) {
      const score = evaluateHand([...p.hole, ...game.community]);
      if (compareHands(score, best) > 0) best = score;
    }
  }
  return best;
}

export const AI_PERSONALITIES = [
  { name: 'Alex', aggression: 0.6 },
  { name: 'Sam', aggression: 0.35 },
  { name: 'Jordan', aggression: 0.8 },
  { name: 'Riley', aggression: 0.5 },
  { name: 'Casey', aggression: 0.45 },
];
