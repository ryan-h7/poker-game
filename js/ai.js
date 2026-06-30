import {
  classifyHand, boardTexture, analyzeBlockers, boardScareFactor,
} from './engine.js';
import { getOpponentRead, getPrimaryVillain, getLimpedPotRead, getPreflopSizeMult } from './opponent.js';

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

/**
 * Effective stack depth, SPR, and commitment — shapes preflop ranges and postflop pot control.
 */
export function getStackContext(game, player, playerIndex) {
  const bb = Math.max(game.bigBlind, 1);
  const heroTotal = player.chips + player.bet;
  const stackBB = heroTotal / bb;

  let effectiveChips = heroTotal;
  for (const p of game.players) {
    if (!p.inHand || p.folded) continue;
    effectiveChips = Math.min(effectiveChips, p.chips + p.bet);
  }
  const effectiveStackBB = effectiveChips / bb;

  const toCall = Math.max(0, game.currentBet - player.bet);
  const potAfterCall = Math.max(game.pot + toCall, bb);
  const spr = effectiveChips / potAfterCall;

  const callFraction = heroTotal > 0 ? toCall / heroTotal : 0;
  const isAllInFacing = toCall > 0 && toCall >= player.chips;
  const isShort = effectiveStackBB < 22;
  const isShallow = effectiveStackBB < 40;
  const isDeep = effectiveStackBB > 75;
  const isVeryDeep = effectiveStackBB > 110;
  const lowSpr = spr < 4;
  const highSpr = spr > 11;
  const isPotCommitted = callFraction >= 0.38 || lowSpr;

  let callCapMult = 1;
  if (isShallow) callCapMult *= 0.82;
  if (isShort) callCapMult *= 0.68;
  if (isDeep) callCapMult *= 1.1;
  if (isVeryDeep) callCapMult *= 1.16;
  if (lowSpr && game.community.length > 0) callCapMult *= 1.12;
  if (highSpr && game.community.length > 0) callCapMult *= 0.9;

  let speculativeMult = 1;
  if (isDeep) speculativeMult = 1.22;
  if (isVeryDeep) speculativeMult = 1.32;
  if (isShallow) speculativeMult = 0.62;
  if (isShort) speculativeMult = 0.42;

  let bluffMult = 1;
  if (isShallow) bluffMult = 0.72;
  if (isShort) bluffMult = 0.55;
  if (isDeep) bluffMult = 1.12;

  let openThresholdAdj = 0;
  if (isShort) openThresholdAdj = 0.09;
  else if (isShallow) openThresholdAdj = 0.04;
  else if (isDeep) openThresholdAdj = -0.03;
  else if (isVeryDeep) openThresholdAdj = -0.05;

  let sizingMult = 1;
  if (isShallow) sizingMult = 0.88;
  if (isShort) sizingMult = 0.78;
  if (isDeep) sizingMult = 1.06;

  return {
    stackBB,
    effectiveStackBB,
    spr,
    callFraction,
    isAllInFacing,
    isShort,
    isShallow,
    isDeep,
    isVeryDeep,
    lowSpr,
    highSpr,
    isPotCommitted,
    callCapMult,
    speculativeMult,
    bluffMult,
    openThresholdAdj,
    sizingMult,
  };
}

/** Max chips willing to put in relative to stack (uses facing size + depth). */
function withinStackCallCap(toCall, player, baseFraction, facing, stackCtx) {
  const mult = (facing.stackFoldMult ?? 1) * stackCtx.callCapMult;
  return toCall <= player.chips * baseFraction * mult;
}

function coldCallTightness(pressure) {
  if (pressure <= 0) return 1;
  if (pressure === 1) return 0.78;
  if (pressure === 2) return 0.58;
  return 0.42;
}

/** ±spread random multiplier for sizing (e.g. 0.92–1.08 at spread 0.08). */
function sizeJitter(spread = 0.1) {
  return 1 - spread + Math.random() * spread * 2;
}

function clampRaiseTo(game, player, target) {
  const minTarget = game.currentBet + game.minRaise;
  const maxTarget = player.bet + player.chips;
  return Math.min(maxTarget, Math.max(minTarget, Math.floor(target)));
}

/**
 * Preflop raise-to in chips (BB-based, jittered). Postflop uses pot fractions separately.
 */
function preflopRaiseTo(game, player, {
  facing, aggression, limpRead, potCtx, mode = 'raise', playerIndex,
}) {
  const bb = game.bigBlind;
  const openBB = game.currentBet / bb;
  const limpers = Math.max(limpRead?.limperCount ?? 0, potCtx.callers);
  const punish = limpRead?.isLimpHappy ? 0.25 : 0;

  const villain = getPrimaryVillain(game, playerIndex);
  const villainTightness = villain >= 0 ? getOpponentRead(game, villain).tightness : 0.5;
  const tableTightness = limpRead?.isLimpPot
    ? limpRead.avgTightness
    : villainTightness;
  const styleMult = getPreflopSizeMult(game, playerIndex, aggression, tableTightness);

  let targetBB;
  if (mode === 'iso') {
    targetBB = (2.75 + limpers * 0.7 + punish) * sizeJitter(0.12) * styleMult;
  } else if (!facing.facing) {
    targetBB = (2.15 + aggression * 0.35 + Math.random() * 0.35) * sizeJitter(0.1) * styleMult;
  } else if (openBB <= 2.5) {
    const mult = (3.0 + aggression * 0.55 + Math.random() * 0.85) * sizeJitter(0.14) * styleMult;
    return clampRaiseTo(game, player, openBB * bb * mult);
  } else if (openBB <= 4) {
    const mult = (2.25 + aggression * 0.45 + Math.random() * 0.55) * sizeJitter(0.12) * styleMult;
    return clampRaiseTo(game, player, game.currentBet * mult);
  } else {
    const mult = (2.1 + aggression * 0.4 + Math.random() * 0.75) * sizeJitter(0.18) * styleMult;
    return clampRaiseTo(game, player, game.currentBet * mult);
  }

  return clampRaiseTo(game, player, targetBB * bb);
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

  const heroTotal = player.chips + player.bet;
  const commitRatio = heroTotal > 0 ? toCall / heroTotal : 0;
  const ranks = ['small', 'medium', 'large', 'overbet'];
  let rankIdx = ranks.indexOf(sizeCategory);
  if (commitRatio >= 0.35 && rankIdx < 3) rankIdx += 1;
  if (commitRatio >= 0.55 && rankIdx < 3) rankIdx = Math.max(rankIdx, 2);
  if (commitRatio >= 0.8 || toCall >= player.chips) rankIdx = 3;
  sizeCategory = ranks[rankIdx];

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

/** Highest trap risk among active opponents (for barrel/bluff discipline). */
function getOpponentTrapLine(game, heroIndex) {
  let best = { trapRisk: 0, slowplay: false };
  for (let i = 0; i < game.players.length; i++) {
    if (i === heroIndex) continue;
    const p = game.players[i];
    if (!p.inHand || p.folded) continue;
    const ls = scoreVillainLine(game, i);
    if (ls.trapRisk > best.trapRisk) best = ls;
  }
  return best;
}

function trapCautionMult(trapLine) {
  if (!trapLine.slowplay) return 1;
  return Math.max(0.4, 1 - trapLine.trapRisk * 0.65);
}

function decideCbetOrBarrel(player, game, hand, aggression, barrelCtx, potCtx, stackCtx) {
  const toCall = game.currentBet - player.bet;
  if (toCall > 0) return null;

  const mw = potCtx.multiwayScalar;
  const heroIndex = game.players.indexOf(player);
  const trapLine = getOpponentTrapLine(game, heroIndex);
  const trapMult = trapCautionMult(trapLine);
  const depthMult = stackCtx.sizingMult * (stackCtx.isShort ? 0.85 : 1);

  const betForStreet = (street) => {
    const frac = street === 'flop'
      ? 0.33 + aggression * 0.2
      : street === 'turn'
        ? 0.55 + aggression * 0.15
        : 0.62 + aggression * 0.18;
    const sized = frac * depthMult;
    return Math.min(player.chips, Math.max(game.minRaise, Math.floor(game.pot * sized)));
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
    if (hand.category === 'air' && Math.random() < freq * 0.55 * stackCtx.bluffMult) {
      const amt = betForStreet('flop');
      if (amt > 0) return makeBet(amt, { isCbet: true, isBluff: true });
    }
    if (potCtx.isMultiway) return { action: 'check' };
  }

  // ── Turn barrel (fired flop c-bet and got called) ──
  if (barrelCtx.isTurnBarrelSpot) {
    const dryBonus = ['dry-high', 'dry-low', 'neutral'].includes(barrelCtx.texture) ? 1.2 : 0.75;
    const barrelFreq = (0.38 + aggression * 0.28) * dryBonus * mw * trapMult;

    if (hand.category === 'premium') {
      const amt = betForStreet('turn');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2 });
    }
    if (hand.category === 'marginal') {
      let barrelChance = (0.55 + aggression * 0.2) * mw * trapMult;
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
    if (hand.category === 'air' && Math.random() < barrelFreq * 0.35 * stackCtx.bluffMult) {
      const amt = betForStreet('turn');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 2, isBluff: true });
    }
    return { action: 'check' };
  }

  // ── River triple barrel (polarized) ──
  if (barrelCtx.isRiverBarrelSpot) {
    const tripleFreq = (0.14 + aggression * 0.18) * mw * trapMult;

    if (hand.category === 'premium'
        || (hand.category === 'marginal' && hand.strength > 0.28 && isStrongPair(hand))) {
      const amt = betForStreet('river');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 3 });
    }
    if (hand.category === 'air' && Math.random() < tripleFreq * stackCtx.bluffMult) {
      const amt = betForStreet('river');
      if (amt > 0) return makeBet(amt, { isBarrel: true, barrelStreet: 3, isBluff: true });
    }
    return { action: 'check' };
  }

  return null;
}

/** Defender vs c-bet / barrel. */
function decideVsBarrel(player, game, hand, aggression, facing, barrelCtx, potCtx, oppRead, stackCtx) {
  const toCall = game.currentBet - player.bet;
  if (toCall <= 0) return null;

  const pa = game.preflopAggressor;
  const bettor = game.bettingLine.streets[game.phase]?.bettor;
  const facingAggressorBarrel = bettor === pa && pa >= 0 && game.players.indexOf(player) !== pa;
  if (!facingAggressorBarrel) return null;

  const isCbet = game.phase === 'flop' && game.bettingLine.barrelCount === 1;
  const isBarrel = game.phase === 'turn' || game.phase === 'river';
  const mwFoldBias = potCtx.isMultiway ? 0.12 : 0;
  const lineScore = bettor >= 0 ? scoreVillainLine(game, bettor) : { trapRisk: 0, slowplay: false };
  const trapRespect = lineScore.slowplay || lineScore.trapRisk >= 0.32;

  if (hand.category === 'premium') {
    if (stackCtx.isPotCommitted || stackCtx.lowSpr) return { action: 'call' };
    return { action: 'call' };
  }
  if (hand.category === 'draw') {
    const potOdds = toCall / (game.pot + toCall);
    let need = 0.32 + hand.draws.drawStrength * 0.2 + mwFoldBias;
    if (stackCtx.isDeep) need -= 0.04;
    if (stackCtx.isShallow) need += 0.05;
    if (potOdds < need) return { action: 'call' };
    if (isBarrel && facing.sizeCategory === 'large') return { action: 'fold' };
    if (potCtx.isMultiway && facing.sizeCategory !== 'small') return { action: 'fold' };
    if (stackCtx.isShallow && facing.sizeCategory === 'medium' && hand.draws.drawStrength < 0.55) {
      return { action: 'fold' };
    }
    return { action: 'call' };
  }
  if (hand.category === 'marginal') {
    if (trapRespect && !isStrongPair(hand)) {
      if (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet') return { action: 'fold' };
      if (Math.random() < lineScore.trapRisk * 0.55) return { action: 'fold' };
    }
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
      if (stackCtx.highSpr && tier === 'middle' && !stackCtx.isPotCommitted) {
        if (Math.random() > aggression * 0.4 + floatBonus) return { action: 'fold' };
      } else if (tier === 'middle' && Math.random() > aggression * 0.45 + floatBonus) {
        return { action: 'fold' };
      }
      if (Math.random() > aggression * 0.5 + (oppRead.isStabBluffer ? -0.12 : 0)) return { action: 'fold' };
    }
    const potOdds = toCall / (game.pot + toCall);
    let callThreshold = (tier === 'top' || tier === 'overpair' ? 0.32
      : tier === 'middle' ? 0.28
        : tier === 'bottom' ? 0.22
          : tier === 'underpair' ? 0.18
            : 0.28) + floatBonus;
    if (stackCtx.lowSpr && (tier === 'top' || tier === 'overpair')) callThreshold += 0.08;
    if (stackCtx.highSpr && tier === 'middle') callThreshold -= 0.04;
    if (potOdds < callThreshold) return { action: 'call' };
    if (withinStackCallCap(toCall, player, callThreshold, facing, stackCtx) && stackCtx.isPotCommitted
        && (tier === 'top' || tier === 'overpair')) {
      return { action: 'call' };
    }
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
function decideVsProbe(player, game, hand, aggression, facing, potCtx, oppRead, stackCtx) {
  const toCall = game.currentBet - player.bet;
  if (toCall <= 0) return null;

  const bettor = game.bettingLine.streets[game.phase]?.bettor;
  const pa = game.preflopAggressor;
  if (bettor === undefined || bettor === game.players.indexOf(player)) return null;
  if (bettor === pa && game.bettingLine.barrelCount >= 1) return null;

  const potOdds = toCall / (game.pot + toCall);

  const lineScore = bettor >= 0 ? scoreVillainLine(game, bettor) : { trapRisk: 0, slowplay: false };
  const trapRespect = lineScore.slowplay || lineScore.trapRisk >= 0.32;

  if (hand.category === 'premium') return { action: 'call' };

  if (hand.category === 'draw') {
    const need = 0.3 + hand.draws.drawStrength * 0.22
      - (oppRead.isStabBluffer ? 0.06 : 0)
      - (stackCtx.isDeep ? 0.04 : 0)
      + (stackCtx.isShallow ? 0.05 : 0);
    if (trapRespect && facing.sizeCategory === 'large') return { action: 'fold' };
    if (potOdds < need * oppRead.floatMult) return { action: 'call' };
    if (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet') return { action: 'fold' };
    return { action: 'call' };
  }

  if (hand.category === 'marginal') {
    if (trapRespect && !isStrongPair(hand)) {
      if (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet') return { action: 'fold' };
      if (Math.random() < lineScore.trapRisk * 0.5) return { action: 'fold' };
    }
    if (oppRead.isStabHappy && facing.sizeCategory === 'small') {
      const threshold = 0.3 + oppRead.callThresholdBonus;
      if (potOdds < threshold * oppRead.floatMult) return { action: 'call' };
    }
    if (isStrongPair(hand) && facing.sizeCategory !== 'overbet') {
      if (stackCtx.highSpr && facing.sizeCategory === 'large' && !stackCtx.isPotCommitted) {
        return { action: 'fold' };
      }
      return { action: 'call' };
    }
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
function decideCheckRaise(player, game, hand, aggression, facing, potCtx, blockers, playerIndex, oppRead, stackCtx) {
  if (!isFacingStreetBet(game, playerIndex)) return null;

  const toCall = game.currentBet - player.bet;
  const mw = potCtx.multiwayScalar;
  const blockerBonus = blockers.score;
  const crMult = oppRead.checkRaiseMult;

  const raiseAmt = () => {
    const multiplier = 2.2 + aggression * 0.8 + blockerBonus * 0.4;
    const depthBoost = stackCtx.isShallow ? 1.15 : stackCtx.isDeep ? 0.95 : 1;
    const target = Math.floor((toCall * multiplier + game.pot * (0.22 + aggression * 0.12)) * depthBoost);
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
    if (stackCtx.isShallow && stackCtx.callFraction > 0.25) return null;
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
function decideOverbetLine(player, game, hand, aggression, barrelCtx, potCtx, blockers, stackCtx) {
  if (game.currentBet > player.bet || game.community.length === 0) return null;
  if (barrelCtx.isCbetSpot || barrelCtx.isTurnBarrelSpot || barrelCtx.isRiverBarrelSpot) return null;

  const mw = potCtx.multiwayScalar;
  if (potCtx.isMultiway && game.phase !== 'river') return null;
  if (stackCtx.isShallow && stackCtx.effectiveStackBB < 30) return null;

  const overbetFrac = (1.05 + aggression * 0.4 + blockers.score * 0.15) * stackCtx.sizingMult;
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
    const freq = (0.08 + aggression * 0.18 + blockers.score * 0.28) * mw * stackCtx.bluffMult;
    if (Math.random() < freq) return makeOb({ isBluff: true });
  }

  return null;
}

/** Iso-raise limpers — wider and larger vs players who limp too often. */
function decidePreflopIso(
  player, game, hand, aggression, posTier, pos, potCtx, limpRead,
  canCheck, facing, effectiveStrength, tryIsoRaise, stackCtx,
) {
  if (!limpRead?.isLimpPot) return null;

  const punish = limpRead.isLimpHappy;
  const mw = potCtx.multiwayScalar * stackCtx.speculativeMult;

  if (hand.category === 'premium') {
    if (stackCtx.isShort && (canCheck || facing.facing)) {
      return { action: 'raise', amount: player.bet + player.chips };
    }
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
    if (hand.category === 'speculative' && (posTier === 'late' || posTier === 'btn') && !stackCtx.isShallow) {
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

const SIZE_STRENGTH_BOOST = {
  small: 0.06,
  medium: 0.11,
  large: 0.18,
  overbet: 0.28,
};

const POSTFLOP_STREETS = ['flop', 'turn', 'river'];

function readStreetEntry(playerStreets, street) {
  const v = playerStreets?.[street];
  if (!v) return null;
  if (typeof v === 'string') return { action: v, checkedFirst: false };
  return v;
}

function isCheckCall(entry) {
  return entry?.action === 'call' && entry.checkedFirst;
}

function scoreTrapPotential(game, villainIndex, { flop, turn, river }) {
  let trapRisk = 0;
  const texture = boardTexture(game.community);
  const scare = boardScareFactor(game.community);
  const pfa = game.preflopAggressor === villainIndex;

  if (isCheckCall(flop)) {
    trapRisk += 0.14;
    if (pfa) trapRisk += 0.1;
    if (texture === 'wet' || texture === 'paired') trapRisk += 0.1;
    if (scare >= 0.1) trapRisk += 0.06;
  }
  if (isCheckCall(turn)) {
    trapRisk += 0.16;
    if (isCheckCall(flop)) trapRisk += 0.14;
  }
  if (isCheckCall(river)) trapRisk += 0.12;

  if (flop?.action === 'check' && turn?.action === 'call' && !turn.checkedFirst) {
    trapRisk += 0.07;
  }
  if (flop?.action === 'check' && turn?.action === 'check' && river?.action === 'raise') {
    trapRisk += 0.18;
  }
  if ((isCheckCall(flop) || isCheckCall(turn)) && (river?.action === 'raise' || turn?.action === 'raise')) {
    trapRisk += 0.15;
  }

  const calls = [flop, turn, river].filter(e => e?.action === 'call').length;
  const bets = [flop, turn, river].filter(e => e?.action === 'bet' || e?.action === 'raise').length;
  if (calls >= 2 && bets === 0 && (texture === 'wet' || texture === 'paired' || scare >= 0.12)) {
    trapRisk += 0.11;
  }

  return Math.min(1, trapRisk);
}

/**
 * Narrow villain range from their line across prior + current streets.
 */
export function scoreVillainLine(game, villainIndex) {
  const empty = { strengthAdj: 0, capped: false, polarized: false, trapRisk: 0, slowplay: false };
  if (villainIndex < 0 || game.community.length < 3) return empty;

  const ps = game.bettingLine?.playerStreets?.[villainIndex] || {};
  const currentIdx = POSTFLOP_STREETS.indexOf(game.phase);
  if (currentIdx < 0) return empty;

  const flop = readStreetEntry(ps, 'flop');
  const turn = readStreetEntry(ps, 'turn');
  const river = readStreetEntry(ps, 'river');
  const line = POSTFLOP_STREETS.slice(0, currentIdx + 1)
    .map(s => readStreetEntry(ps, s))
    .filter(Boolean);

  let strengthAdj = 0;
  let capped = false;
  let polarized = false;

  const trapRisk = scoreTrapPotential(game, villainIndex, { flop, turn, river });
  const slowplay = trapRisk >= 0.28;

  const bets = line.filter(e => e.action === 'bet' || e.action === 'raise').length;
  const calls = line.filter(e => e.action === 'call').length;
  const checks = line.filter(e => e.action === 'check').length;
  const checkCalls = line.filter(isCheckCall).length;

  if (calls >= 1) strengthAdj += 0.03 + (calls - 1) * 0.055;
  if (calls >= 2) strengthAdj += 0.04;

  if (bets >= 2) {
    strengthAdj += 0.07 + (bets - 2) * 0.045;
    polarized = true;
  }

  if (checks >= 1 && bets === 0 && !slowplay) {
    strengthAdj -= 0.04 + checks * 0.035;
    capped = true;
  }

  if (slowplay) {
    strengthAdj += trapRisk * 0.14;
    capped = false;
  }

  if (flop?.action === 'call' && turn?.action === 'call' && currentIdx >= 1) {
    strengthAdj += 0.08;
  }
  if (flop?.action === 'call' && turn?.action === 'bet' && currentIdx >= 1) {
    strengthAdj += 0.07;
  }
  if (flop?.action === 'bet' && turn?.action === 'call' && currentIdx >= 1) {
    strengthAdj += 0.05;
  }
  if (flop?.action === 'check' && turn?.action === 'bet' && currentIdx >= 1) {
    strengthAdj += 0.04;
  }
  if (flop?.action === 'check' && turn?.action === 'check' && currentIdx >= 1 && !slowplay) {
    strengthAdj -= 0.08;
    capped = true;
  }
  if (flop?.action === 'bet' && turn?.action === 'bet' && currentIdx >= 1) {
    strengthAdj += 0.05;
    polarized = true;
  }
  if (calls >= 2 && river?.action === 'bet' && currentIdx >= 2) {
    strengthAdj += 0.09;
    polarized = true;
  }
  if (checkCalls >= 1) {
    strengthAdj += 0.03 + (checkCalls - 1) * 0.05;
  }
  if (flop?.action === 'check' && turn?.action === 'call' && currentIdx >= 1 && !slowplay) {
    strengthAdj += 0.02;
    capped = true;
  }
  if (line[line.length - 1]?.action === 'raise') {
    strengthAdj += 0.06;
    polarized = true;
  }

  return {
    strengthAdj: Math.max(-0.18, Math.min(0.22, strengthAdj)),
    capped,
    polarized,
    trapRisk,
    slowplay,
  };
}

/**
 * Estimate villain range strength (0–1) from board + betting line only — no hole cards.
 */
export function estimateVillainRangeStrength(game, playerIndex, { facing, barrelCtx, oppRead, potCtx }) {
  if (game.community.length < 3) return 0.45;

  const line = game.bettingLine;
  const villainIndex = getPrimaryVillain(game, playerIndex);
  const streetBettor = line.streets[game.phase]?.bettor;
  const villainLed = streetBettor !== undefined && streetBettor !== playerIndex
    && (villainIndex < 0 || streetBettor === villainIndex);

  const lineTarget = villainIndex >= 0 ? villainIndex : streetBettor;
  const lineScore = lineTarget >= 0
    ? scoreVillainLine(game, lineTarget)
    : { strengthAdj: 0, capped: false, polarized: false, trapRisk: 0, slowplay: false };

  let strength = 0.26 + boardScareFactor(game.community) + lineScore.strengthAdj;

  if (lineScore.slowplay) {
    strength += lineScore.trapRisk * 0.16;
    if (facing.facing && (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet')) {
      strength += 0.06;
    }
  }

  if (facing.facing) {
    strength += SIZE_STRENGTH_BOOST[facing.sizeCategory] ?? 0.1;
    if (line.barrelCount >= 2) strength += 0.04;
    if (line.barrelCount >= 3) strength += 0.03;
    if (villainLed && barrelCtx.texture === 'wet') strength += 0.04;
    if (lineScore.polarized && (facing.sizeCategory === 'large' || facing.sizeCategory === 'overbet')) {
      strength += 0.05;
    }
    if (lineScore.slowplay && villainLed) strength += lineScore.trapRisk * 0.1;
  } else if (villainLed) {
    strength += 0.08;
  }

  if (lineScore.capped && !lineScore.slowplay) {
    strength = Math.min(strength, 0.46);
  } else if (lineScore.slowplay) {
    strength = Math.max(strength, 0.36 + lineScore.trapRisk * 0.22);
  }

  if (potCtx?.isMultiway && facing.facing) strength += 0.05;

  if (oppRead) {
    if (oppRead.tightness > 0.58 && facing.facing) strength += 0.06;
    if (oppRead.isStabBluffer && villainLed) strength -= 0.09;
    if (oppRead.isStabHappy && facing.facing && facing.sizeCategory === 'small') strength -= 0.05;
    if (lineScore.capped && oppRead.isStabHappy && villainLed) strength -= 0.04;
    if (lineScore.slowplay && oppRead.tightness > 0.52) strength += 0.05;
  }

  return Math.max(0.14, Math.min(0.88, strength));
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
  const stackCtx = getStackContext(game, player, playerIndex);
  const villainIndex = getPrimaryVillain(game, playerIndex);
  const oppRead = getOpponentRead(game, villainIndex);
  const limpRead = isPreflop ? getLimpedPotRead(game, playerIndex) : null;

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
    const villainRange = estimateVillainRangeStrength(game, playerIndex, {
      facing, barrelCtx, oppRead, potCtx,
    });
    const ahead = hand.strength > villainRange + 0.1;
    const behind = hand.strength < villainRange - 0.1;
    strength = strength * 0.65 + (ahead ? 0.25 : behind ? -0.1 : 0);
    if (hand.category === 'draw') strength += hand.draws.drawStrength * 0.15;
  }

  const aggression = player.personality?.aggression ?? 0.5;

  if (!isPreflop) {
    if (!canCheck) {
      const checkRaise = decideCheckRaise(
        player, game, hand, aggression, facing, potCtx, blockers, playerIndex, oppRead, stackCtx,
      );
      if (checkRaise) return checkRaise;
    } else {
      const barrelAction = decideCbetOrBarrel(player, game, hand, aggression, barrelCtx, potCtx, stackCtx);
      if (barrelAction) return barrelAction;

      const overbet = decideOverbetLine(
        player, game, hand, aggression, barrelCtx, potCtx, blockers, stackCtx,
      );
      if (overbet) return overbet;
    }

    const defendAction = decideVsBarrel(
      player, game, hand, aggression, facing, barrelCtx, potCtx, oppRead, stackCtx,
    );
    if (defendAction) return defendAction;

    const probeAction = decideVsProbe(
      player, game, hand, aggression, facing, potCtx, oppRead, stackCtx,
    );
    if (probeAction) return probeAction;
  }

  let effectiveStrength = strength - pos.strengthAdj + stackCtx.openThresholdAdj;
  if (facing.facing) {
    effectiveStrength -= facing.strengthPenalty;
    effectiveStrength -= potCtx.callers * 0.04;
    effectiveStrength -= potCtx.playersBehind * 0.035;
    if (!isPreflop && potCtx.isMultiway) effectiveStrength -= 0.03;
    if (stackCtx.isShallow && !isPreflop) effectiveStrength -= 0.03;
    if (stackCtx.isDeep && isPreflop) effectiveStrength += 0.02;
  }

  const bluffRoll = Math.random() < 0.14 * aggression * pos.bluffMult * potCtx.multiwayScalar
    * stackCtx.bluffMult
    * (facing.sizeCategory === 'overbet' ? 0.25 : facing.sizeCategory === 'large' ? 0.5 : 1);

  const raiseSize = () => {
    const potFactor = facing.facing && facing.sizeCategory === 'small'
      ? 0.55 + aggression * 0.45
      : 0.45 + aggression * 0.55;
    const sized = potFactor * stackCtx.sizingMult;
    return Math.min(player.chips, Math.max(game.minRaise, Math.floor(game.pot * sized)));
  };

  const tryRaise = (isBluff, isSemiBluff = false) => {
    const target = isPreflop
      ? preflopRaiseTo(game, player, {
        facing, aggression, limpRead, potCtx, mode: 'raise', playerIndex,
      })
      : (() => {
        const amt = raiseSize();
        return player.bet + (canCheck ? amt : Math.min(amt, player.chips));
      })();
    if (target <= player.bet || target > player.bet + player.chips) return null;
    if (!canCheck && target <= game.currentBet) return null;
    if (!canCheck && target - player.bet > player.chips) return null;
    return { action: 'raise', amount: target, isBluff, isSemiBluff };
  };

  const tryIsoRaise = (isBluff, isSemiBluff = false) => {
    const target = preflopRaiseTo(game, player, {
      facing, aggression, limpRead, potCtx, mode: 'iso', playerIndex,
    });
    if (target <= player.bet || target <= game.currentBet) return null;
    return { action: 'raise', amount: target, isBluff, isSemiBluff, isIso: true };
  };

  if (isPreflop) {
    const isoAction = decidePreflopIso(
      player, game, hand, aggression, posTier, pos, potCtx, limpRead,
      canCheck, facing, effectiveStrength, tryIsoRaise, stackCtx,
    );
    if (isoAction) return isoAction;
  }

  if (hand.category === 'premium') {
    const valueThreshold = pos.openThreshold - aggression * 0.05 + facing.reraiseExtra
      + stackCtx.openThresholdAdj;
    if (effectiveStrength > valueThreshold) {
      if (stackCtx.isShort && (facing.facing || !canCheck) && player.chips > 0) {
        return { action: 'raise', amount: player.bet + player.chips };
      }
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
      const stackCap = (0.28 + drawPower * 0.2) * cold * stackCtx.speculativeMult;
      if (potOdds <= drawPotOdds && withinStackCallCap(toCall, player, stackCap, facing, stackCtx)) {
        return { action: 'call' };
      }
      if (facing.sizeCategory === 'overbet') return { action: 'fold' };
      if (facing.sizeCategory === 'large' && drawPower < 0.5) return { action: 'fold' };
      if (withinStackCallCap(toCall, player, 0.15, facing, stackCtx)) return { action: 'call' };
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
      maxBB *= cold * stackCtx.speculativeMult;
      if (stackCtx.isShort && hand.strength < 0.42) return { action: 'fold' };
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
    const callFrac = (callLimit + callLimitAdj) * stackCtx.callCapMult;
    if (potOdds < 0.3 * cold && withinStackCallCap(toCall, player, callFrac, facing, stackCtx)) {
      return { action: 'call' };
    }
    if (stackCtx.lowSpr && (isStrongPair(hand) || tier === 'top' || tier === 'overpair')) {
      return { action: 'call' };
    }
    if (toCall <= game.bigBlind * 2 * cold * stackCtx.speculativeMult
        && facing.sizeCategory !== 'overbet' && !isWeakPair(hand)) {
      return { action: 'call' };
    }
    return { action: 'fold' };
  }

  if (canCheck) return { action: 'check' };
  if (withinStackCallCap(toCall, player, 0.2, facing, stackCtx)) return { action: 'call' };
  return { action: 'fold' };
}

export const AI_PERSONALITIES = [
  { name: 'Alex', aggression: 0.6 },
  { name: 'Sam', aggression: 0.35 },
  { name: 'Jordan', aggression: 0.8 },
  { name: 'Riley', aggression: 0.5 },
  { name: 'Casey', aggression: 0.45 },
];
