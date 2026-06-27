import { classifyHand, evaluateHand } from './engine.js';

export function createOpponentProfile() {
  return {
    hands: 0,
    stabOpps: 0,
    stabs: 0,
    stabShowdowns: 0,
    stabWeakShowdowns: 0,
    cbetOpps: 0,
    cbets: 0,
    facedBets: 0,
    checkRaises: 0,
    facedCheckRaises: 0,
    foldsToCheckRaise: 0,
    betsRaises: 0,
    passives: 0,
    limpOpps: 0,
    limps: 0,
    pfrOpps: 0,
    pfrRaises: 0,
    preflopRaises: 0,
    preflopCalls: 0,
    preflopFolds: 0,
  };
}

const DEFAULT_READ = {
  stabFreq: 0.38,
  isStabHappy: false,
  isStabBluffer: false,
  crFreq: 0.08,
  foldToCr: 0.45,
  foldsToCr: false,
  aggFreq: 0.35,
  sampleSize: 0,
  checkRaiseMult: 1,
  floatMult: 1,
  callThresholdBonus: 0,
  limpFreq: 0.22,
  isLimpHappy: false,
  isoRaiseMult: 1,
  isoThresholdDrop: 0,
  tightness: 0.5,
  isTight: false,
  isLoose: false,
};

export function ensureOpponentProfiles(game) {
  if (!game.opponentProfiles) {
    game.opponentProfiles = game.players.map(() => createOpponentProfile());
  }
  while (game.opponentProfiles.length < game.players.length) {
    game.opponentProfiles.push(createOpponentProfile());
  }
}

export function resetOpponentProfiles(game) {
  game.opponentProfiles = game.players.map(() => createOpponentProfile());
}

export function initHandReadState(game) {
  const n = game.players.length;
  game.handReadState = {
    cbetOppCounted: false,
    perPlayer: Array.from({ length: n }, () => ({
      checkedThisStreet: false,
      stabbedThisHand: false,
      stabStreets: [],
    })),
  };
}

export function onHandReadNewStreet(game) {
  const hs = game.handReadState;
  if (!hs) return;
  for (const p of hs.perPlayer) {
    p.checkedThisStreet = false;
  }
}

/**
 * @param {object} ctx
 * @param {number} ctx.toCall
 * @param {boolean} ctx.checkedTo — postflop, unopened pot when they act
 * @param {boolean} ctx.isCheckRaise
 * @param {boolean} ctx.isCbet
 * @param {boolean} ctx.countCbetOpp
 */
export function observeAction(game, playerIndex, action, ctx) {
  if (game.replaying) return;
  ensureOpponentProfiles(game);
  const profiles = game.opponentProfiles;
  const hs = game.handReadState;
  if (!hs || playerIndex < 0) return;

  const profile = profiles[playerIndex];
  const street = hs.perPlayer[playerIndex];

  if (ctx.countLimpOpp) profile.limpOpps += 1;
  if (ctx.isLimp) profile.limps += 1;
  if (ctx.countPfrOpp) profile.pfrOpps += 1;
  if (ctx.countPfrOpp && (action === 'raise' || action === 'allin')) profile.pfrRaises += 1;

  if (game.phase === 'preflop') {
    if (action === 'raise' || action === 'allin') profile.preflopRaises += 1;
    else if (action === 'call' && ctx.toCall > 0) profile.preflopCalls += 1;
    else if (action === 'fold' && ctx.toCall > 0) profile.preflopFolds += 1;
  }

  if (ctx.countCbetOpp) {
    profile.cbetOpps += 1;
    hs.cbetOppCounted = true;
  }

  if (ctx.checkedTo) {
    profile.stabOpps += 1;
    if (action === 'raise' || action === 'allin') {
      profile.stabs += 1;
      street.stabbedThisHand = true;
      street.stabStreets.push(game.phase);
    }
  }

  if (action === 'check') {
    street.checkedThisStreet = true;
    profile.passives += 1;
  } else if (action === 'call' && ctx.toCall > 0) {
    profile.passives += 1;
    if (street.checkedThisStreet) profile.facedBets += 1;
  } else if (action === 'raise' || action === 'allin') {
    profile.betsRaises += 1;
    if (ctx.isCheckRaise) profile.checkRaises += 1;
    if (ctx.isCbet) profile.cbets += 1;
  } else if (action === 'fold' && ctx.toCall > 0) {
    const raiser = game.lastRaiser;
    const raiserStreet = raiser >= 0 ? hs.perPlayer[raiser] : null;
    if (raiserStreet?.checkedThisStreet && raiser !== playerIndex) {
      profile.facedCheckRaises += 1;
      profile.foldsToCheckRaise += 1;
    }
  }
}

export function updateStabShowdownReads(game) {
  if (game.replaying) return;
  ensureOpponentProfiles(game);
  const hs = game.handReadState;
  if (!hs || game.community.length < 3) return;

  for (let i = 0; i < game.players.length; i++) {
    const street = hs.perPlayer[i];
    if (!street?.stabbedThisHand || !game.players[i].hole?.length) continue;

    const hand = classifyHand(game.players[i].hole, game.community);
    const profile = game.opponentProfiles[i];
    profile.stabShowdowns += 1;
    if (hand.category === 'air' || (hand.category === 'marginal' && hand.strength < 0.22)) {
      profile.stabWeakShowdowns += 1;
    }
  }
}

export function finalizeHandReads(game) {
  if (game.replaying) return;
  ensureOpponentProfiles(game);
  for (const profile of game.opponentProfiles) {
    profile.hands += 1;
  }
  game.handReadState = null;
}

/** 0 = very loose, 1 = very tight (session sample). */
export function computeTightness(profile) {
  if (!profile || profile.hands < 2) return 0.5;

  const hands = profile.hands;
  const vpip = (profile.preflopRaises + profile.limps + profile.preflopCalls) / hands;
  const pfr = profile.pfrOpps >= 3
    ? profile.pfrRaises / profile.pfrOpps
    : profile.preflopRaises / hands;
  const foldFreq = profile.preflopFolds
    / Math.max(1, profile.preflopFolds + profile.preflopCalls + profile.preflopRaises);

  const looseness = Math.min(1, vpip * 1.35 + (1 - pfr) * 0.45 + (1 - foldFreq) * 0.15);
  return Math.max(0, Math.min(1, 1 - looseness));
}

/** Preflop raise size multiplier from actor style + villain/table tightness. */
export function getPreflopSizeMult(game, playerIndex, aggression, tableTightness = 0.5) {
  const selfTightness = 1 - aggression;
  let mult = 1;

  // Tight players raise bigger, loose players smaller
  mult += (selfTightness - 0.5) * 0.26;

  // Vs tight table/villain: size up (fold equity); vs loose: size down (induce)
  mult += (tableTightness - 0.5) * 0.24;

  return Math.max(0.84, Math.min(1.2, mult));
}

export function getOpponentRead(game, opponentIndex) {
  if (opponentIndex < 0) return { ...DEFAULT_READ };
  ensureOpponentProfiles(game);
  const p = game.opponentProfiles[opponentIndex];
  if (!p || p.hands < 2) return { ...DEFAULT_READ };

  const stabFreq = p.stabOpps >= 2 ? p.stabs / p.stabOpps : null;
  const stabBluffRate = p.stabShowdowns >= 1 ? p.stabWeakShowdowns / p.stabShowdowns : null;
  const crFreq = p.facedBets >= 2 ? p.checkRaises / p.facedBets : null;
  const foldToCr = p.facedCheckRaises >= 1 ? p.foldsToCheckRaise / p.facedCheckRaises : null;
  const total = p.betsRaises + p.passives;
  const aggFreq = total > 0 ? p.betsRaises / total : 0.35;

  const isStabHappy = stabFreq !== null && stabFreq > 0.52;
  const isStabBluffer = stabBluffRate !== null && stabBluffRate >= 0.5;
  const foldsToCr = foldToCr !== null && foldToCr > 0.55;

  let checkRaiseMult = 1;
  if (isStabHappy) checkRaiseMult += 0.22;
  if (isStabBluffer) checkRaiseMult += 0.32;
  if (foldsToCr) checkRaiseMult += 0.28;
  if (crFreq !== null && crFreq > 0.16) checkRaiseMult += 0.12;

  let floatMult = 1;
  if (isStabHappy) floatMult += 0.18;
  if (isStabBluffer) floatMult += 0.28;

  let callThresholdBonus = 0;
  if (isStabHappy) callThresholdBonus += 0.04;
  if (isStabBluffer) callThresholdBonus += 0.06;

  const limpFreq = p.limpOpps >= 3 ? p.limps / p.limpOpps : null;
  const isLimpHappy = limpFreq !== null && limpFreq > 0.34;
  const isoRaiseMult = isLimpHappy ? 1.28 : 1;
  const isoThresholdDrop = isLimpHappy ? 0.07 + Math.min(0.05, (limpFreq - 0.34) * 0.25) : 0;

  const tightness = computeTightness(p);
  const isTight = tightness >= 0.58;
  const isLoose = tightness <= 0.38;

  return {
    stabFreq: stabFreq ?? DEFAULT_READ.stabFreq,
    isStabHappy,
    isStabBluffer,
    crFreq: crFreq ?? DEFAULT_READ.crFreq,
    foldToCr: foldToCr ?? DEFAULT_READ.foldToCr,
    foldsToCr,
    aggFreq,
    sampleSize: p.hands,
    checkRaiseMult,
    floatMult,
    callThresholdBonus,
    limpFreq: limpFreq ?? DEFAULT_READ.limpFreq,
    isLimpHappy,
    isoRaiseMult,
    isoThresholdDrop,
    tightness,
    isTight,
    isLoose,
  };
}

/** Primary villain for the current decision (bettor, last raiser, or preflop aggressor). */
export function getPrimaryVillain(game, playerIndex) {
  if (game.community.length > 0) {
    const bettor = game.bettingLine.streets[game.phase]?.bettor;
    if (bettor !== undefined && bettor !== playerIndex) return bettor;
  }
  if (game.lastRaiser >= 0 && game.lastRaiser !== playerIndex) return game.lastRaiser;
  if (game.preflopAggressor >= 0 && game.preflopAggressor !== playerIndex) {
    return game.preflopAggressor;
  }
  return -1;
}

/** Reads for a limped preflop pot (callers at the big blind). */
export function getLimpedPotRead(game, playerIndex) {
  const empty = {
    isLimpPot: false,
    limperCount: 0,
    avgLimpFreq: 0.22,
    avgTightness: 0.5,
    isLimpHappy: false,
    isoThresholdDrop: 0,
    isoRaiseMult: 1,
    isoSizeMult: 1,
  };
  if (game.community.length > 0 || game.currentBet !== game.bigBlind) return empty;

  const limpers = [];
  for (let i = 0; i < game.players.length; i++) {
    if (i === playerIndex) continue;
    const p = game.players[i];
    if (!p.inHand || p.folded || p.bet !== game.bigBlind) continue;
    limpers.push(getOpponentRead(game, i));
  }

  if (!limpers.length) return empty;

  const avgLimpFreq = limpers.reduce((s, r) => s + r.limpFreq, 0) / limpers.length;
  const avgTightness = limpers.reduce((s, r) => s + r.tightness, 0) / limpers.length;
  const isLimpHappy = avgLimpFreq > 0.32 || limpers.some(r => r.isLimpHappy);
  const isoThresholdDrop = isLimpHappy
    ? 0.05 + Math.min(0.08, (avgLimpFreq - 0.28) * 0.22)
    : 0.02;

  return {
    isLimpPot: true,
    limperCount: limpers.length,
    avgLimpFreq,
    avgTightness,
    isLimpHappy,
    isoThresholdDrop,
    isoRaiseMult: isLimpHappy ? 1.22 + limpers.length * 0.06 : 1.08,
    isoSizeMult: 1 + limpers.length * 0.35 + (isLimpHappy ? 0.25 : 0),
  };
}

export function buildActionReadContext(game, playerIndex, action, toCall) {
  const postflop = game.community.length > 0;
  const checkedTo = postflop && toCall === 0 && game.currentBet === 0;
  const street = game.handReadState?.perPlayer[playerIndex];
  const isCheckRaise = (action === 'raise' || action === 'allin')
    && toCall > 0
    && !!street?.checkedThisStreet;
  const isPfa = playerIndex === game.preflopAggressor;
  const countCbetOpp = game.phase === 'flop' && isPfa && checkedTo
    && !game.handReadState?.cbetOppCounted;
  const isCbet = countCbetOpp && (action === 'raise' || action === 'allin');

  const isPreflop = game.phase === 'preflop' && game.community.length === 0;
  const facingBlindsOnly = isPreflop && toCall > 0 && game.currentBet === game.bigBlind;
  const countLimpOpp = facingBlindsOnly;
  const isLimp = countLimpOpp && action === 'call';
  const countPfrOpp = isPreflop && game.currentBet === game.bigBlind && toCall <= game.bigBlind;

  return {
    toCall,
    checkedTo,
    isCheckRaise,
    isCbet,
    countCbetOpp,
    countLimpOpp,
    isLimp,
    countPfrOpp,
  };
}
