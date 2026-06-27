const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_COLORS = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

export const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush'
];

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, value: RANK_VALUES[rank] });
    }
  }
  return deck;
}

export function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function combinations(arr, k) {
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

function evaluateFive(cards) {
  const values = cards.map(c => c.value).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ value: +v, count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const unique = [...new Set(values)].sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;

  if (unique.length >= 5) {
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) {
        isStraight = true;
        straightHigh = unique[i];
        break;
      }
    }
    if (!isStraight && unique.includes(14) && unique.includes(5) &&
        unique.includes(4) && unique.includes(3) && unique.includes(2)) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  if (isFlush && isStraight) {
    const rank = straightHigh === 14 && values.includes(10) ? 9 : 8;
    return { rank, kickers: [straightHigh] };
  }
  if (groups[0].count === 4) {
    const kicker = groups.find(g => g.count === 1);
    return { rank: 7, kickers: [groups[0].value, kicker.value] };
  }
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: 6, kickers: [groups[0].value, groups[1].value] };
  }
  if (isFlush) {
    return { rank: 5, kickers: values };
  }
  if (isStraight) {
    return { rank: 4, kickers: [straightHigh] };
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.value);
    return { rank: 3, kickers: [groups[0].value, ...kickers] };
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const kicker = groups.find(g => g.count === 1);
    const pairs = [groups[0].value, groups[1].value].sort((a, b) => b - a);
    return { rank: 2, kickers: [...pairs, kicker.value] };
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.value);
    return { rank: 1, kickers: [groups[0].value, ...kickers] };
  }
  return { rank: 0, kickers: values };
}

export function evaluateHand(cards) {
  if (cards.length < 5) return { rank: 0, kickers: [0] };
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const score = evaluateFive(combo);
    if (!best || compareHands(score, best) > 0) best = score;
  }
  return best;
}

export function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const diff = (a.kickers[i] || 0) - (b.kickers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function formatHoleCards(hole) {
  return hole.map(c => `${c.rank}${c.suit}`).join(' ');
}

export function handName(score) {
  return HAND_NAMES[score.rank] || 'Unknown';
}

export function preflopStrength(hole) {
  const [a, b] = hole.map(c => c.value).sort((x, y) => y - x);
  const suited = hole[0].suit === hole[1].suit;
  const pair = a === b;

  if (pair) return 0.5 + a / 28;
  if (a >= 14 && b >= 13) return 0.75 + (suited ? 0.05 : 0);
  if (a >= 14) return 0.45 + b / 30 + (suited ? 0.08 : 0);
  if (a >= 13 && b >= 12) return 0.55 + (suited ? 0.1 : 0);
  if (suited && a - b <= 2 && a >= 9) return 0.4 + a / 40;
  if (a >= 11 && b >= 10) return 0.42;
  return 0.15 + a / 50 + b / 100;
}

/** Detect flush/straight draws from hole + community (post-flop). */
export function detectDraws(hole, community) {
  if (community.length < 3) {
    return { drawStrength: 0, types: [], outs: 0, flushDraw: false, straightDraw: false };
  }

  const cards = [...hole, ...community];
  const types = [];
  let drawStrength = 0;
  let outs = 0;

  const suitCounts = {};
  for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const flushDraw = Object.values(suitCounts).some(n => n === 4);
  if (flushDraw) {
    types.push('flush');
    drawStrength += 0.44;
    outs += 9;
  }

  let values = [...new Set(cards.map(c => c.value))];
  if (values.includes(14)) values.push(1);
  values = [...new Set(values)].sort((a, b) => a - b);

  let straightType = null;
  for (let i = 0; i <= values.length - 4; i++) {
    const span = values[i + 3] - values[i];
    if (span === 3) {
      straightType = 'oesd';
      break;
    }
    if (span === 4) straightType = straightType || 'gutshot';
  }

  if (straightType === 'oesd') {
    types.push('oesd');
    drawStrength += 0.38;
    outs += 8;
  } else if (straightType === 'gutshot') {
    types.push('gutshot');
    drawStrength += 0.22;
    outs += 4;
  }

  if (flushDraw && straightType) {
    types.push('combo');
    drawStrength = Math.min(0.72, drawStrength + 0.18);
    outs += 2;
  }

  return {
    drawStrength: Math.min(0.75, drawStrength),
    types,
    outs,
    flushDraw,
    straightDraw: !!straightType,
  };
}

/**
 * Classify one-pair strength relative to the board.
 * @returns {{ tier: 'top'|'middle'|'bottom'|'overpair'|'underpair', pairRank: number, kickerStrength: number } | null}
 */
export function getPairTier(hole, community, made) {
  if (!made || made.rank !== 1 || community.length < 3) return null;

  const pairRank = made.kickers[0];
  const boardRanks = [...new Set(community.map(c => c.value))].sort((a, b) => b - a);
  const holeValues = hole.map(c => c.value).sort((a, b) => b - a);
  const isPocket = holeValues[0] === holeValues[1];

  if (isPocket && pairRank === holeValues[0] && pairRank >= boardRanks[0]) {
    return { tier: 'overpair', pairRank, kickerStrength: 1 };
  }

  if (isPocket && !boardRanks.includes(pairRank)) {
    return {
      tier: 'underpair',
      pairRank,
      kickerStrength: Math.min(0.35, 0.12 + pairRank / 36),
    };
  }

  const boardIdx = boardRanks.indexOf(pairRank);
  if (boardIdx >= 0) {
    let tier = 'middle';
    if (boardIdx === 0) tier = 'top';
    else if (boardIdx === boardRanks.length - 1) tier = 'bottom';

    let kickerStrength = 0.35;
    if (tier === 'top') {
      const kicker = holeValues.find(v => v !== pairRank) ?? holeValues[1];
      kickerStrength = Math.min(1, Math.max(0.15, (kicker - 2) / 12));
    } else if (tier === 'bottom') {
      kickerStrength = 0.2;
    }
    return { tier, pairRank, kickerStrength };
  }

  return { tier: 'bottom', pairRank, kickerStrength: 0.2 };
}

const PAIR_TIER_STRENGTH = {
  overpair: 0.14,
  top: 0.08,
  middle: 0,
  bottom: -0.07,
  underpair: -0.11,
};

/** Bucket a hand for AI strategy: premium / marginal / draw / air. */
export function classifyHand(hole, community) {
  if (community.length === 0) {
    const s = preflopStrength(hole);
    if (s >= 0.72) return { category: 'premium', strength: s, draws: null };
    if (s >= 0.42) return { category: 'marginal', strength: s, draws: null };
    return { category: 'speculative', strength: s, draws: null };
  }

  const made = evaluateHand([...hole, ...community]);
  const madeStrength = (made.rank + 1) / 10;
  const draws = detectDraws(hole, community);

  if (made.rank >= 3) return { category: 'premium', strength: madeStrength, draws, made };
  if (made.rank >= 1) {
    let pairTier = null;
    let blended = Math.max(madeStrength, madeStrength + draws.drawStrength * 0.25);

    if (made.rank === 1) {
      pairTier = getPairTier(hole, community, made);
      if (pairTier) {
        blended += PAIR_TIER_STRENGTH[pairTier.tier] ?? 0;
        if (pairTier.tier === 'top') blended += pairTier.kickerStrength * 0.05;
        blended = Math.max(0.08, Math.min(0.38, blended));
      }
    }

    const category = made.rank >= 2 || (pairTier?.tier === 'overpair' && blended >= 0.26)
      ? 'premium'
      : 'marginal';
    return { category, strength: blended, draws, made, pairTier };
  }

  if (draws.drawStrength >= 0.35) {
    const blended = Math.max(madeStrength, draws.drawStrength * 0.9);
    return { category: 'draw', strength: blended, draws, made };
  }

  return { category: 'air', strength: madeStrength, draws, made };
}

/** Rough flop texture for c-bet frequency. */
export function boardTexture(community) {
  if (community.length < 3) return 'none';
  const ranks = community.slice(0, 3).map(c => c.value);
  const suits = community.slice(0, 3).map(c => c.suit);
  const paired = new Set(ranks).size < ranks.length;
  const maxRank = Math.max(...ranks);
  const monotone = new Set(suits).size === 1;
  if (monotone) return 'wet';
  if (paired) return 'paired';
  if (maxRank >= 13) return 'dry-high';
  if (maxRank <= 8) return 'dry-low';
  return 'neutral';
}

/**
 * Blocker score for bluff / check-raise lines (0–1).
 * Higher = more removal of villain value combos.
 */
export function analyzeBlockers(hole, community) {
  if (community.length < 3) {
    return {
      score: 0,
      nutFlushBlock: false,
      straightBlock: false,
      pairBlock: false,
      details: [],
    };
  }

  let score = 0;
  const details = [];

  const suitCounts = {};
  for (const c of community) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const flushSuit = Object.entries(suitCounts).find(([, n]) => n >= 3)?.[0];
  if (flushSuit) {
    const holeFlush = hole.filter(c => c.suit === flushSuit);
    if (holeFlush.some(c => c.value === 14)) {
      score += 0.35;
      details.push('nut-flush-block');
    } else if (holeFlush.some(c => c.value === 13)) {
      score += 0.2;
      details.push('king-flush-block');
    } else if (holeFlush.length) {
      score += 0.1;
      details.push('flush-block');
    }
  }

  const rankCounts = {};
  for (const c of community) rankCounts[c.value] = (rankCounts[c.value] || 0) + 1;
  const pairedRank = Object.entries(rankCounts).find(([, n]) => n >= 2)?.[0];
  if (pairedRank && hole.some(c => c.value === +pairedRank)) {
    score += 0.15;
    details.push('board-pair-block');
  }

  const boardValues = community.map(c => c.value);
  const maxBoard = Math.max(...boardValues);
  if (hole.some(c => c.value === maxBoard || c.value === maxBoard - 1)) {
    score += 0.12;
    details.push('straight-block');
  }

  if (maxBoard >= 12) {
    if (hole.some(c => c.value === 14)) {
      score += 0.1;
      details.push('ace-block');
    } else if (hole.some(c => c.value === 13)) {
      score += 0.06;
      details.push('king-block');
    }
  }

  return {
    score: Math.min(1, score),
    nutFlushBlock: details.includes('nut-flush-block'),
    straightBlock: details.includes('straight-block'),
    pairBlock: details.includes('board-pair-block'),
    details,
  };
}
