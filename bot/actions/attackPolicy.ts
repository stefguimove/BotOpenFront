/**
 * Attack gating: the bot must mass before it attacks.
 *
 * Without a reserve the agent attacks every second with a fraction of a tiny
 * army, so the army can never grow: troop regeneration per decision is spent
 * immediately and the count settles at a few hundred men against a cap of
 * hundreds of thousands. Measured on 3 compact 3600-tick games with random
 * weights, holding a reserve changes the outcome completely:
 *
 * | reserve | mean tile share | mean troops |
 * | ------- | --------------- | ----------- |
 * | 0       | 0.0064          | 902         |
 * | 0.05    | 0.105           | 87 526      |
 * | 0.1     | 0.221           | 346 863     |
 * | 0.2     | 0.429           | 720 314     |
 * | 0.3     | 0.576           | 1 498 182   |
 * | 0.5     | 0.526           | 2 985 995   |
 */
export const ATTACK_POLICY = {
  /** Fraction of maxTroops that must be held before attacking. */
  reserve: 0.3,
} as const;

/**
 * True when the standing army is large enough to spend troops on an attack.
 * Unknown caps (0, NaN) are treated as "allowed" so a broken observation can
 * never freeze the bot.
 */
export function attackAllowed(
  troops: number,
  maxTroops: number,
  reserve: number = ATTACK_POLICY.reserve,
): boolean {
  if (!(reserve > 0)) return true;
  if (!Number.isFinite(maxTroops) || maxTroops <= 0) return true;
  return (Number.isFinite(troops) ? troops : 0) >= reserve * maxTroops;
}
