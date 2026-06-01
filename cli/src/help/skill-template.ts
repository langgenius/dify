// The only hand-authored part of the agent skill (D3.0). Everything else in
// SKILL.md and reference/*.md is derived from the single source of truth
// (CONTRACT, the command tree, agentGuide(), TOPICS) by renderSkill(). This
// shell holds the three things that have nowhere to derive from: the
// frontmatter trigger, a one-line statement of what the skill provides, and
// the framing for the safety section. The golden-path `workflow` is a
// curated ordering of existing command paths — its prose is still derived
// from each command's own description and examples.

export type SkillShell = {
  // Skill frontmatter. `description` is the trigger an agent matches on.
  readonly name: string
  readonly description: string
  // One line stating what installing this skill grants.
  readonly opening: string
  // Lead-in prose for the SAFETY section; the command lists below it are derived.
  readonly safetyFraming: string
  // The core workflow chain, as ordered command paths. Each step's wording is
  // pulled from that command's own descriptor, not written here.
  readonly workflow: readonly string[]
}

export const SKILL_SHELL: SkillShell = {
  name: 'difyctl',
  description:
    'Drive the Dify platform from the command line with difyctl: authenticate, '
    + 'list and inspect apps, run apps (including workflow apps that pause for '
    + 'human input), and manage workspace members. Use when a task involves '
    + 'invoking a Dify app or workspace from a shell.',
  opening:
    'This skill teaches an agent to operate `difyctl`, the Dify command-line '
    + 'interface. Every command supports `-o json` for stable, machine-readable '
    + 'output — always pass it.',
  safetyFraming:
    'difyctl commands are classified by what they do to remote state. Read-only '
    + 'commands are safe to call freely and are not listed here. Confirm intent '
    + 'before any command below, and treat `destructive` commands as irreversible.',
  workflow: ['auth login', 'get app', 'describe app', 'run app', 'resume app'],
}
