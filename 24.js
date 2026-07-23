// ===================== Card System =====================
// Owns: current hand, drawn cards, running total toward 24.
// Talks to: Health/Combat System (feeds stand/bust outcome),
//           Card-Effect System (routes an effect card's play).

const DECK_POOL = [1,2,3,4,5,6,7,8,9,10,10,10,10,11]; // 10/J/Q/K collapse to 10

export function createCardState() {
  return {
    hand: [],
    runningTotal: 0,
    standStatus: 'drawing', // 'drawing' | 'stood' | 'bust'
  };
}

export function drawCard(cardState) {
  const value = DECK_POOL[Math.floor(Math.random() * DECK_POOL.length)];
  cardState.hand.push(value);
  cardState.runningTotal += value;
  if (cardState.runningTotal > 24) {
    cardState.standStatus = 'bust';
  }
  return value;
}

export function stand(cardState) {
  if (cardState.hand.length === 0) return;
  cardState.standStatus = 'stood';
}

export function getTier(runningTotal) {
  if (runningTotal === 24) return 3;
  if (runningTotal >= 21) return 2;
  if (runningTotal >= 18) return 1;
  return 0;
}

export function resetHand(cardState) {
  cardState.hand = [];
  cardState.runningTotal = 0;
  cardState.standStatus = 'drawing';
}


// ===================== Card-Effect System =====================
// Owns: the four fixed effects, their costs, and which effects are
//       currently active on the player (persist over multiple turns,
//       stack additively when duplicated).
// Talks to: Card System (receives play trigger, deducts cost),
//           Health/Combat System (active effects modify damage there).

export const EFFECTS = {
  quick:  { name: 'Quick Strike', cost: 2,  damage: 10 },
  double: { name: 'Double Down',  cost: 10, damage: 10, buffsNext: true },
  feint:  { name: 'Feint',        cost: 5,  selfDamage: 1, skipsGuardTurn: true },
  allin:  { name: 'All In',       cost: 7,  selfDamage: 15, damage: 45 },
};

export function createEffectState() {
  return {
    resource: 20,       // matches START_RESOURCE from the tunable params table
    activeEffects: [],  // [{ kind, name, turnsRemaining }]
  };
}

export function canAfford(effectState, kind) {
  if (!EFFECTS[kind]) return false; // invalid kind
  return effectState.resource >= EFFECTS[kind].cost; // true if enough resource
}

export function hasActiveEffect(effectState, kind) {
  return effectState.activeEffects.some(effect => effect.kind === kind && effect.turnsRemaining > 0);
}

export function playEffect(effectState, kind) {
  if (!canAfford(effectState, kind)) {
    return null;
  }
  effectState.resource -= EFFECTS[kind].cost;

  const def = EFFECTS[kind];
  let damageToGuard = def.damage || 0;
  let selfDamage = def.selfDamage || 0;

  // Double Down's buff applies to the *next* played card, not to itself -
  // so exclude kind 'double' from consuming its own stack here.
  if (kind !== 'double' && damageToGuard > 0) {
    const doubleEntry = effectState.activeEffects.find(e => e.kind === 'double');
    if (doubleEntry) {
      // additive stacking: each stacked Double Down contributes another x2
      // (x2 + x2 = x4 total for two stacks, x2 + x2 + x2 = x6 for three, etc.)
      const multiplier = 2 * doubleEntry.stackCount;
      damageToGuard *= multiplier;
      effectState.activeEffects = effectState.activeEffects.filter(e => e.kind !== 'double');
    }
  }

  if (def.buffsNext) {
    const existing = effectState.activeEffects.find(e => e.kind === kind);
    if (existing) {
      existing.stackCount += 1;
      existing.turnsRemaining = 1; // refresh duration on re-stack
    } else {
      effectState.activeEffects.push({ kind, name: def.name, turnsRemaining: 1, stackCount: 1 });
    }
  }
  if (def.skipsGuardTurn) {
    effectState.activeEffects.push({ kind, name: def.name, turnsRemaining: 1, stackCount: 1 });
  }

  return { damageToGuard, selfDamage, skipsGuardTurn: def.skipsGuardTurn || false };
}

export function tickEffects(effectState) {
  effectState.activeEffects.forEach(effect => {
    effect.turnsRemaining -= 1;
  });
  effectState.activeEffects = effectState.activeEffects.filter(effect => effect.turnsRemaining > 0);
}

// Health/Combat System
// Owns: player HP, Guard HP, stand-timing damage resolution
//       (including bust overshoot self-damage), and the Guard's
//       turn-based attack.
// Talks to: Card System (reads standStatus + runningTotal),
//           Card-Effect System (reads playEffect's returned
//             { damageToGuard, selfDamage, skipsGuardTurn }),
//           Level System (cut for the slice - not needed here).

export const PARAMS = {
  TIER1_DAMAGE: 5,
  TIER2_DAMAGE: 10,
  TIER3_DAMAGE: 20,
  BUST_SELF_DAMAGE: 10,
  PLAYER_MAX_HEALTH: 100,
  GUARD_MAX_HEALTH: 40,
  GUARD_ATTACK_DAMAGE: 3,
};

export function createCombatState() {
  return {
    playerHealth: PARAMS.PLAYER_MAX_HEALTH,
    guardHealth: PARAMS.GUARD_MAX_HEALTH,
  };
}

export function resolveStandDamage(combatState, cardState, getTierFn) {
  // TODO: called when standStatus is 'stood' or 'bust'.
  let damageToGuard = 0;
  let selfDamage = 0;
  if (cardState.standStatus === 'bust') { // player busted, apply self-damage
    selfDamage = PARAMS.BUST_SELF_DAMAGE;
    combatState.playerHealth -= selfDamage;
  } else if (cardState.standStatus === 'stood') { // player stood, apply damage to guard based on tier
    const tier = getTierFn(cardState.runningTotal);
    if (tier === 1) damageToGuard = PARAMS.TIER1_DAMAGE; // tier 1 damage
    if (tier === 2) damageToGuard = PARAMS.TIER2_DAMAGE; // tier 2 damage
    if (tier === 3) damageToGuard = PARAMS.TIER3_DAMAGE; // tier 3 damage
    combatState.guardHealth -= damageToGuard;
  }
  return { damageToGuard, selfDamage };
}
