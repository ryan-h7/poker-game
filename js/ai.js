import { evaluateHand, compareHands, preflopStrength } from './engine.js';

export function decideAction(player, game) {
  const toCall = game.currentBet - player.bet;
  const canCheck = toCall === 0;
  const potOdds = toCall > 0 ? toCall / (game.pot + toCall) : 0;

  let strength;
  if (game.community.length === 0) {
    strength = preflopStrength(player.hole);
  } else {
    const score = evaluateHand([...player.hole, ...game.community]);
    strength = (score.rank + 1) / 10;
    const maxOpp = estimateOpponentStrength(game, player);
    strength = strength * 0.7 + (compareHands(score, maxOpp) > 0 ? 0.3 : 0);
  }

  const aggression = player.personality?.aggression ?? 0.5;
  const bluff = Math.random() < 0.08 * aggression;

  if (strength < 0.2 && !bluff) {
    if (canCheck) return { action: 'check' };
    if (toCall > player.chips * 0.15) return { action: 'fold' };
    if (toCall <= game.bigBlind) return { action: 'call' };
    return { action: 'fold' };
  }

  if (strength > 0.75 || (strength > 0.55 && bluff)) {
    const raiseAmt = Math.min(
      player.chips,
      Math.max(game.minRaise, Math.floor(game.pot * (0.5 + aggression * 0.5)))
    );
    if (raiseAmt > toCall && player.chips > toCall) {
      return { action: 'raise', amount: player.bet + raiseAmt };
    }
    if (!canCheck) return { action: 'call' };
    return { action: 'check' };
  }

  if (strength > 0.4 || potOdds < 0.25) {
    if (canCheck) return { action: 'check' };
    if (toCall <= player.chips * 0.3) return { action: 'call' };
    return { action: 'fold' };
  }

  if (canCheck) return { action: 'check' };
  if (toCall <= game.bigBlind * 2) return { action: 'call' };
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
];
