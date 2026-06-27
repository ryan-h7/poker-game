import {
  evaluateHand, compareHands, classifyHand, boardTexture, analyzeBlockers,
} from './engine.js';
import { getOpponentRead, getPrimaryVillain, getLimpedPotRead } from './opponent.js';

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

function pairTier(hand) {
  return hand.pairTier?.tier ?? null;
}

function isStrongPair(hand) {
  const t = pairTier(hand);
  return t === 'overpair' || t === 'top';
}

function isWeakPair(hand) {
  const t = pairTier(hand);
  return t === 'bottom' || t === 'underpair';
}

function pairCbetFreq(hand, base) {
  const t = pairTier(hand);
  if (t === 'overpair') return base * 1.15;
  if (t === 'top') return base * (0.95 + (hand.pairTier.kickerStrength ?? 0.5) * 0.2);
  if (t === 'middle') return base * 0.82;
  if (t === 'bottom') return base * 0.45;
  if (t === 'underpair') return base * 0.3;
  return base;
}

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
      const valueCbet = pairCbetFreq(hand, potCtx.isMultiway
        ? 0.3 + aggression * 0.22
        : 0.82 + aggression * 0.12);
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
    if (hand.category === 'marginal') {
      let barrelChance = (0.55 + aggression * 0.2) * mw;
      if (isStrongPair(hand)) barrelChance *= 1.2;
      else if (isWeakPair(hand)) barrelChance *= 0.35;
      else if (pairTier(hand) === 'middle') barrelChance *= 0.75;
      if (Math.random() < barrelChance) {
        const amt = betForStreet('turn');
        if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2 });
      }
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

    if (hand.category === 'premium'
        || (hand.category === 'marginal' && hand.strength > 0.28 && isStrongPair(hand))) {
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
function decideVsBarrel(player, game, hand, aggression, facing, barrelCtx, potCtx, oppRead) {
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
    const tier = pairTier(hand);
    const floatBonus = oppRead.callThresholdBonus;
    if (isCbet && facing.sizeCategory === 'small' && !potCtx.isMultiway) {
      if (isWeakPair(hand) && !oppRead.isStabBluffer && Math.random() > 0.35) return { action: 'fold' };
      return { action: 'call' };
    }
    if (isCbet && potCtx.isMultiway && facing.sizeCategory === 'small') {
      let callFreq = tier === 'top' || tier === 'overpair' ? 0.55 : tier === 'middle' ? 0.4 : 0.2;
      if (oppRead.isStabHappy) callFreq += 0.1;
      if (Math.random() < callFreq) return { action: 'call' };
      return { action: 'fold' };
    }
    if (isBarrel && facing.sizeCategory !== 'small') {
      if (isWeakPair(hand) && !oppRead.isStabBluffer) return { action: 'fold' };
      if (tier === 'middle' && Math.random() > aggression * 0.45 + floatBonus) return { action: 'fold' };
      if (Math.random() > aggression * 0.5 + (oppRead.isStabBluffer ? -0.12 : 0)) return { action: 'fold' };
    }
    const potOdds = toCall / (game.pot + toCall);
    const callThreshold = (tier === 'top' || tier === 'overpair' ? 0.32
      : tier === 'middle' ? 0.28
        : tier === 'bottom' ? 0.22
          : tier === 'underpair' ? 0.18
            : 0.28) + floatBonus;
    if (potOdds < callThreshold) return { action: 'call' };
    return { action: 'fold' };
  }
  // air vs barrel — float more vs stab-happy bluffers
  if (isCbet && facing.sizeCategory === 'small') {
    const floatFreq = (0.12 + (oppRead.isStabBluffer ? 0.18 : 0)) * (1 - aggression) * oppRead.floatMult;
    if (Math.random() < floatFreq) return { action: 'call' };
  }
  return { action: 'fold' };
}

/** Facing a probe / stab (non–c-bet lead when checked to). */
function decideVsProbe(player, game, hand, aggression, facing, potCtx, oppRead) {
  const toCall = game.currentBet - player.bet;
  if (toCall <= 0) return null;

  const bettor = game.bettingLine.streets[game.phase]?.bettor;
  const pa = game.preflopAggressor;
  if (bettor === undefined || bettor === game.players.indexOf(player)) return null;
  if (bettor === pa && game.bettingLine.barrelCount >= 1) return null;

  const potOdds = toCall / (game.pot + toCall);

  if (hand.category === 'premium') return { action: 'call' };

  if (hand.category === 'draw') {
    const need = 0.3 + hand.draws.drawStrength * 0.22
      - (oppRead.isStabBluffer ? 0.06 : 0);
    if (potOdds < need * oppRead.floatMult) return { action: 'call' };
    if (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet') return { action: 'fold' };
    return { action: 'call' };
  }

  if (hand.category === 'marginal') {
    if (oppRead.isStabHappy && facing.sizeCategory === 'small') {
      const threshold = 0.3 + oppRead.callThresholdBonus;
      if (potOdds < threshold * oppRead.floatMult) return { action: 'call' };
    }
    if (isStrongPair(hand) && facing.sizeCategory !== 'overbet') return { action: 'call' };
    if (isWeakPair(hand) && !oppRead.isStabBluffer) return { action: 'fold' };
    if (potOdds < 0.24 + oppRead.callThresholdBonus) return { action: 'call' };
    return { action: 'fold' };
  }

  if (hand.category === 'air' && oppRead.isStabBluffer && facing.sizeCategory === 'small') {
    if (Math.random() < 0.14 * oppRead.floatMult * (1 - aggression * 0.3)) {
      return { action: 'call' };
    }
  }

  return null;
}

function isFacingStreetBet(game, playerIndex) {
  const street = game.phase;
  if (street === 'preflop' || street === 'idle' || street === 'showdown') return false;
  const bettor = game.bettingLine.streets[street]?.bettor;
  if (bettor === undefined || bettor === playerIndex) return false;
  return game.currentBet > game.players[playerIndex].bet;
}

/** Facing a bet after checking this street (or facing a re-raise). */
function decideCheckRaise(player, game, hand, aggression, facing, potCtx, blockers, playerIndex, oppRead) {
  if (!isFacingStreetBet(game, playerIndex)) return null;

  const toCall = game.currentBet - player.bet;
  const mw = potCtx.multiwayScalar;
  const blockerBonus = blockers.score;
  const crMult = oppRead.checkRaiseMult;

  const raiseAmt = () => {
    const multiplier = 2.2 + aggression * 0.8 + blockerBonus * 0.4;
    const target = Math.floor(toCall * multiplier + game.pot * (0.22 + aggression * 0.12));
    const minExtra = game.currentBet + game.minRaise - player.bet;
    return Math.min(player.chips - toCall, Math.max(minExtra, target));
  };

  const makeCR = (meta) => {
    const extra = raiseAmt();
    if (extra <= 0 || player.chips <= toCall) return null;
    return {
      action: 'raise',
      amount: player.bet + toCall + extra,
      isCheckRaise: true,
      ...meta,
    };
  };

  if (hand.category === 'premium') {
    const freq = ((potCtx.isMultiway ? 0.5 : 0.72 + aggression * 0.15)
      * (facing.sizeCategory === 'small' ? 1 : 0.82)) * crMult;
    if (Math.random() < Math.min(0.95, freq)) return makeCR({}) || { action: 'call' };
  }

  if (hand.category === 'draw') {
    if (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet') return null;
    const freq = (0.2 + aggression * 0.32 + blockerBonus * 0.28) * mw * crMult;
    if (Math.random() < freq) return makeCR({ isSemiBluff: true });
  }

  if (hand.category === 'marginal') {
    if (isStrongPair(hand) && (facing.sizeCategory === 'small' || facing.sizeCategory === 'medium')) {
      const freq = (0.12 + aggression * 0.18 + (hand.pairTier.kickerStrength ?? 0.5) * 0.12)
        * mw * crMult;
      if (Math.random() < Math.min(0.85, freq)) return makeCR({}) || { action: 'call' };
    }
    if (oppRead.foldsToCr && (facing.sizeCategory === 'small' || facing.sizeCategory === 'medium')) {
      const freq = (0.1 + aggression * 0.14 + (hand.strength > 0.22 ? 0.08 : 0)) * mw * crMult;
      if (Math.random() < freq) return makeCR({}) || { action: 'call' };
    }
    if (blockerBonus >= 0.2 && !isWeakPair(hand)) {
      if (facing.sizeCategory === 'small' || facing.sizeCategory === 'medium') {
        const freq = (0.07 + aggression * 0.14 + blockerBonus * 0.22) * mw * crMult;
        if (Math.random() < freq) return makeCR({ isBluff: true });
      }
    }
    if (isWeakPair(hand) && blockerBonus >= 0.28 && facing.sizeCategory === 'small') {
      const freq = (0.04 + aggression * 0.08 + blockerBonus * 0.15) * mw * crMult;
      if (oppRead.isStabBluffer) {
        if (Math.random() < freq * 1.4) return makeCR({ isBluff: true });
      } else if (Math.random() < freq) {
        return makeCR({ isBluff: true });
      }
    }
  }

  if (hand.category === 'air' && blockerBonus >= 0.28) {
    if (facing.sizeCategory === 'small') {
      const freq = (0.05 + aggression * 0.1 + blockerBonus * 0.18) * mw;
      if (Math.random() < freq) return makeCR({ isBluff: true });
    }
  }

  return null;
}

/** Polar overbet when checked to (non–c-bet spots or river). */
function decideOverbetLine(player, game, hand, aggression, barrelCtx, potCtx, blockers) {
  if (game.currentBet > player.bet || game.community.length === 0) return null;
  if (barrelCtx.isCbetSpot || barrelCtx.isTurnBarrelSpot || barrelCtx.isRiverBarrelSpot) return null;

  const mw = potCtx.multiwayScalar;
  if (potCtx.isMultiway && game.phase !== 'river') return null;

  const overbetFrac = 1.05 + aggression * 0.4 + blockers.score * 0.15;
  const amt = Math.min(
    player.chips,
    Math.max(game.minRaise, Math.floor(game.pot * overbetFrac)),
  );
  const makeOb = (meta) => (amt > 0
    ? { action: 'raise', amount: player.bet + amt, isOverbet: true, ...meta }
    : null);

  const isRiver = game.phase === 'river';
  const nutty = hand.category === 'premium' && hand.strength > 0.32;
  const polarBluff = hand.category === 'air' && blockers.score >= 0.26;
  const strongDraw = hand.category === 'draw' && hand.draws.drawStrength >= 0.48;

  if (nutty && (isRiver || barrelCtx.texture === 'wet' || blockers.nutFlushBlock)) {
    const freq = (0.16 + aggression * 0.24) * (blockers.nutFlushBlock ? 1.2 : 1);
    if (Math.random() < freq) return makeOb({});
  }

  if (strongDraw && game.phase === 'turn' && blockers.score >= 0.18) {
    if (Math.random() < (0.1 + aggression * 0.16) * mw) return makeOb({ isSemiBluff: true });
  }

  if (polarBluff && isRiver && !barrelCtx.isAggressor) {
    const freq = (0.08 + aggression * 0.18 + blockers.score * 0.28) * mw;
    if (Math.random() < freq) return makeOb({ isBluff: true });
  }

  return null;
}

/** Iso-raise limpers — wider and larger vs players who limp too often. */
function decidePreflopIso(
  player, game, hand, aggression, posTier, pos, potCtx, limpRead,
  canCheck, facing, effectiveStrength, tryIsoRaise,
) {
  if (!limpRead?.isLimpPot) return null;

  const punish = limpRead.isLimpHappy;
  const mw = potCtx.multiwayScalar;

  if (hand.category === 'premium') {
    if (canCheck || (facing.facing && facing.openBB <= 2.5)) {
      const raised = tryIsoRaise(false);
      if (raised) return raised;
    }
    return null;
  }

  if (canCheck && (posTier === 'late' || posTier === 'btn'
      || (posTier === 'middle' && punish))) {
    if (hand.category === 'marginal') {
      const isoThreshold = pos.openThreshold - limpRead.isoThresholdDrop - aggression * 0.05;
      if (effectiveStrength + limpRead.isoThresholdDrop > isoThreshold - 0.1) {
        const freq = (0.42 + aggression * 0.38) * limpRead.isoRaiseMult * mw;
        if (Math.random() < Math.min(0.9, freq)) {
          const raised = tryIsoRaise(hand.strength < 0.5);
          if (raised) return raised;
        }
      }
    }
    if (hand.category === 'speculative' && (posTier === 'late' || posTier === 'btn')) {
      const freq = (0.12 + aggression * 0.3) * (punish ? 1.4 : 0.65) * mw;
      if (Math.random() < freq) {
        const raised = tryIsoRaise(true);
        if (raised) return raised;
      }
    }
    if (hand.category === 'air' && punish && posTier === 'btn') {
      const freq = (0.06 + aggression * 0.14) * limpRead.isoRaiseMult * mw;
      if (Math.random() < freq) {
        const raised = tryIsoRaise(true);
        if (raised) return raised;
      }
    }
  }

  if (!canCheck && facing.facing && facing.openBB <= 2.5 && facing.sizeCategory === 'small') {
    if (hand.category === 'marginal' || hand.category === 'premium') {
      const isoThreshold = pos.openThreshold - limpRead.isoThresholdDrop - 0.08;
      if (effectiveStrength > isoThreshold - 0.06) {
        const raised = tryIsoRaise(false);
        if (raised) return raised;
      }
    }
    if (hand.category === 'speculative' && posTier !== 'early' && punish) {
      if (Math.random() < (0.2 + aggression * 0.28) * limpRead.isoRaiseMult) {
        const raised = tryIsoRaise(true);
        if (raised) return raised;
      }
    }
  }

  return null;
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
  const blockers = isPreflop ? { score: 0, details: [] } : analyzeBlockers(player.hole, game.community);
  let strength = hand.strength;

  if (!isPreflop) {
    strength += blockers.score * 0.08;
    if (hand.category === 'air' || hand.category === 'draw') {
      strength += blockers.score * 0.12;
    }
  }

  if (!isPreflop) {
    const maxOpp = estimateOpponentStrength(game, player);
    const score = hand.made || evaluateHand([...player.hole, ...game.community]);
    strength = strength * 0.65 + (compareHands(score, maxOpp) > 0 ? 0.25 : 0);
    if (hand.category === 'draw') strength += hand.draws.drawStrength * 0.15;
  }

  const aggression = player.personality?.aggression ?? 0.5;
  const villainIndex = getPrimaryVillain(game, playerIndex);
  const oppRead = getOpponentRead(game, villainIndex);
  const limpRead = isPreflop ? getLimpedPotRead(game, playerIndex) : null;

  if (!isPreflop) {
    if (!canCheck) {
      const checkRaise = decideCheckRaise(
        player, game, hand, aggression, facing, potCtx, blockers, playerIndex, oppRead,
      );
      if (checkRaise) return checkRaise;
    } else {
      const barrelAction = decideCbetOrBarrel(player, game, hand, aggression, barrelCtx, potCtx);
      if (barrelAction) return barrelAction;

      const overbet = decideOverbetLine(
        player, game, hand, aggression, barrelCtx, potCtx, blockers,
      );
      if (overbet) return overbet;
    }

    const defendAction = decideVsBarrel(
      player, game, hand, aggression, facing, barrelCtx, potCtx, oppRead,
    );
    if (defendAction) return defendAction;

    const probeAction = decideVsProbe(
      player, game, hand, aggression, facing, potCtx, oppRead,
    );
    if (probeAction) return probeAction;
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

  const tryIsoRaise = (isBluff, isSemiBluff = false) => {
    const bb = game.bigBlind;
    const limpers = Math.max(limpRead?.limperCount ?? 0, potCtx.callers);
    const sizeMult = limpRead?.isoSizeMult ?? 1;
    let target;
    if (canCheck) {
      const openSize = Math.floor((3 + limpers * 1.2) * bb * sizeMult);
      target = player.bet + Math.max(bb * 2, openSize);
    } else {
      const multiplier = 3.2 + aggression * 1.1 + limpers * 0.5 + (limpRead?.isLimpHappy ? 0.4 : 0);
      target = Math.floor(game.currentBet * multiplier + limpers * bb * 0.6);
    }
    target = Math.min(
      player.bet + player.chips,
      Math.max(game.currentBet + game.minRaise, target),
    );
    if (!canCheck && target <= game.currentBet) return null;
    if (target <= player.bet) return null;
    return { action: 'raise', amount: target, isBluff, isSemiBluff, isIso: true };
  };

  if (isPreflop) {
    const isoAction = decidePreflopIso(
      player, game, hand, aggression, posTier, pos, potCtx, limpRead,
      canCheck, facing, effectiveStrength, tryIsoRaise,
    );
    if (isoAction) return isoAction;
  }

  if (hand.category === 'premium') {
    const valueThreshold = pos.openThreshold - aggression * 0.05 + facing.reraiseExtra;
    if (effectiveStrength > valueThreshold) {
      const trapCheck = canCheck && !isPreflop && potCtx.isHeadsUp
        && blockers.score >= 0.18
        && Math.random() < 0.12 + aggression * 0.1;
      if (trapCheck) return { action: 'check' };

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
    const semiBluffFreq = (0.28 + aggression * 0.35 + blockers.score * 0.15) * potCtx.multiwayScalar;
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
        if (!isWeakPair(hand) || potOdds < 0.14) return { action: 'call' };
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
    if (canCheck && blockers.score >= 0.22 && posTier !== 'early' && !potCtx.isMultiway
        && Math.random() < (0.06 + aggression * 0.1 + blockers.score * 0.12)) {
      return { action: 'check' };
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
      if (limpRead?.isLimpHappy && facing.openBB <= 2.5 && facing.sizeCategory === 'small') {
        return { action: 'fold' };
      }
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
          && !isWeakPair(hand)
          && Math.random() < aggression * 0.2) {
        const raised = tryRaise(true);
        if (raised) return raised;
      }
      return { action: 'check' };
    }
    const cold = coldCallTightness(potCtx.coldCallPressure);
    const tier = pairTier(hand);
    let callLimit = ((posTier === 'early' ? 0.2 : 0.3) + facing.callBonus) * cold;
    if (tier === 'top' || tier === 'overpair') callLimit += 0.06 * cold;
    else if (tier === 'bottom' || tier === 'underpair') callLimit -= 0.08 * cold;
    if (facing.sizeCategory === 'small') callLimit += (isStrongPair(hand) ? 0.08 : 0.04) * cold;
    if (potCtx.coldCallPressure >= 2 && hand.strength < 0.5 && !isStrongPair(hand)) {
      return { action: 'fold' };
    }
    if (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet') {
      if (isWeakPair(hand) && !oppRead.isStabBluffer) return { action: 'fold' };
      if (tier === 'middle' && facing.sizeCategory === 'overbet' && !oppRead.isStabHappy) {
        return { action: 'fold' };
      }
    }
    const callLimitAdj = oppRead.isStabBluffer ? 0.04 : 0;
    if (potOdds < 0.3 * cold && toCall <= player.chips * (callLimit + callLimitAdj)) {
      return { action: 'call' };
    }
    if (toCall <= game.bigBlind * 2 * cold && facing.sizeCategory !== 'overbet' && !isWeakPair(hand)) {
      return { action: 'call' };
    }
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
