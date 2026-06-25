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
