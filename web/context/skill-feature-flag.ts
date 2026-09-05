/**
 * Session-scoped last-known value for the Skills workspace flag.
 *
 * `features?.enable_skill ?? false` collapses "not known yet" into "off". That
 * hides a Skills nav row that was already shown whenever the features query is
 * unresolved — including provider remounts that miss the cache — then shows it
 * again once data returns.
 *
 * Unknown must stay unknown: it is not off (would hide an enabled row) and not
 * on (would flash Skills when ENABLE_SKILL is false). After a boolean has been
 * observed in this session, keep it until a new boolean arrives.
 */
let lastKnownEnableSkill: boolean | undefined

export function resolveSkillFeatureFlag(enableSkill: boolean | undefined): boolean | undefined {
  if (typeof enableSkill === 'boolean') {
    lastKnownEnableSkill = enableSkill
    return enableSkill
  }

  return lastKnownEnableSkill
}
