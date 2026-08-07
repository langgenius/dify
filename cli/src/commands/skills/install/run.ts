import type { AgentEntry } from './registry'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderSkill } from '@/help/skill'
import { AGENTS, detectAgents } from './registry'

export type SkillsInstallOptions = {
  readonly version: string
  // Write to disk (true) or just preview the targets (false / dry-run).
  readonly write: boolean
  // Print the skill to stdout and write nothing.
  readonly stdout: boolean
  // Force a single explicit directory, bypassing agent detection.
  readonly dir?: string
  // Restrict to these detected agents (by name); empty = all detected.
  readonly agents: readonly string[]
  // Injectable home dir (defaults to os.homedir()); tests pass a temp dir.
  readonly home?: string
}

export type SkillsInstallResult =
  | { readonly kind: 'ok'; readonly text: string; readonly wrote: readonly string[] }
  | { readonly kind: 'usage'; readonly message: string }

// One write target. Several agents may resolve to the same path (the shared
// `~/.agents/skills` convention), so a target carries every agent name that
// maps to it and the path is written (and listed) once.
type InstallTarget = {
  readonly names: readonly string[]
  readonly path: string
}

// Atomic write: temp file in the destination dir, then rename over any existing
// SKILL.md. Mirrors the store/skill-init pattern; the unique temp name makes
// concurrent installs safe.
async function writeSkill(content: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${process.hrtime.bigint()}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, target)
}

// Group agents by their resolved SKILL.md path, preserving registry order.
// Agents sharing a skillDir collapse into one target with the names merged.
function groupByPath(agents: readonly AgentEntry[], home: string): InstallTarget[] {
  const groups = new Map<string, string[]>()
  for (const agent of agents) {
    const path = join(agent.skillDir(home), 'SKILL.md')
    const names = groups.get(path)
    if (names) names.push(agent.name)
    else groups.set(path, [agent.name])
  }
  return [...groups].map(([path, names]) => ({ names, path }))
}

function resolveTargets(
  opts: SkillsInstallOptions,
  home: string,
): InstallTarget[] | SkillsInstallResult {
  // Explicit directory: skip detection entirely.
  if (opts.dir !== undefined && opts.dir !== '')
    return [{ names: [opts.dir], path: join(resolve(opts.dir), 'SKILL.md') }]

  const detected = detectAgents(home)

  // An explicit --agent must name agents that are actually detected. This is
  // checked before the zero-detected guidance below: naming an agent that is
  // not present (including when none are present) is a usage error, per spec.
  if (opts.agents.length > 0) {
    const known = new Set(detected.map((a) => a.name))
    const unknown = opts.agents.filter((name) => !known.has(name))
    if (unknown.length > 0) {
      return {
        kind: 'usage',
        message: `unknown or undetected agent(s): ${unknown.join(', ')} (detected: ${[...known].join(', ') || 'none'})`,
      }
    }
    return groupByPath(
      detected.filter((a) => opts.agents.includes(a.name)),
      home,
    )
  }

  // No --agent and nothing detected: not an error — guide the user, write nothing.
  if (detected.length === 0) {
    const lookedFor = AGENTS.map((a) => a.probeDir(home).replace(home, '~')).join(', ')
    return {
      kind: 'ok',
      text:
        `No agents detected (looked for ${lookedFor}).\n` +
        'Install into a directory manually with `difyctl skills install <dir>`, or\n' +
        'print the skill with `difyctl skills install --stdout`.\n',
      wrote: [],
    }
  }

  return groupByPath(detected, home)
}

export async function runSkillsInstall(opts: SkillsInstallOptions): Promise<SkillsInstallResult> {
  const home = opts.home ?? homedir()
  const content = renderSkill({ version: opts.version })

  // --stdout: emit the skill, write nothing.
  if (opts.stdout) return { kind: 'ok', text: content, wrote: [] }

  const targets = resolveTargets(opts, home)
  // resolveTargets short-circuits to a terminal result (zero detected / usage).
  if (!Array.isArray(targets)) return targets

  // Dry-run: list where the skill would land, write nothing.
  if (!opts.write) {
    const lines = targets.map((t) => `would write to ${t.names.join(', ')}: ${t.path}`).join('\n')

    // Explicit <dir>: no detection happened, so no agent summary / selectors.
    if (opts.dir !== undefined && opts.dir !== '')
      return { kind: 'ok', text: `${lines}\n\nRe-run with --yes to write.\n`, wrote: [] }

    const names = targets.flatMap((t) => t.names)
    const selected = opts.agents.length > 0
    const header = `${selected ? 'Selected' : 'Detected'} ${names.length} agent${names.length === 1 ? '' : 's'}: ${names.join(', ')}`
    // Only suggest --agent when the user hasn't already used it and there is more
    // than one to choose from. The selectable names are the ones listed above, so
    // the hint just shows the flag, not the (already-visible) name list.
    const pick =
      !selected && names.length > 1
        ? 'Re-run with --yes to write all, or --agent <name> to write only some.'
        : 'Re-run with --yes to write.'
    const footer = `${pick}\nAgent not listed? Install into its directory with \`difyctl skills install <dir>\`.`
    return { kind: 'ok', text: `${header}\n\n${lines}\n\n${footer}\n`, wrote: [] }
  }

  const wrote: string[] = []
  for (const target of targets) {
    await writeSkill(content, target.path)
    wrote.push(target.path)
  }
  return { kind: 'ok', text: `${wrote.map((p) => `wrote ${p}`).join('\n')}\n`, wrote }
}
