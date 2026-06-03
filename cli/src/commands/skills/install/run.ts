import type { AgentEntry } from './registry'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { renderSkill } from '@/help/skill'
import { detectAgents } from './registry'

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

export type SkillsInstallResult
  = | { readonly kind: 'ok', readonly text: string, readonly wrote: readonly string[] }
    | { readonly kind: 'usage', readonly message: string }

type InstallTarget = {
  readonly name: string
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

function resolveTargets(opts: SkillsInstallOptions, home: string): InstallTarget[] | SkillsInstallResult {
  // Explicit directory: skip detection entirely.
  if (opts.dir !== undefined && opts.dir !== '')
    return [{ name: opts.dir, path: join(resolve(opts.dir), 'SKILL.md') }]

  const detected = detectAgents(home)
  const target = (a: AgentEntry): InstallTarget => ({ name: a.name, path: join(a.skillDir(home), 'SKILL.md') })

  // An explicit --agent must name agents that are actually detected. This is
  // checked before the zero-detected guidance below: naming an agent that is
  // not present (including when none are present) is a usage error, per spec.
  if (opts.agents.length > 0) {
    const known = new Set(detected.map(a => a.name))
    const unknown = opts.agents.filter(name => !known.has(name))
    if (unknown.length > 0) {
      return {
        kind: 'usage',
        message: `unknown or undetected agent(s): ${unknown.join(', ')} (detected: ${[...known].join(', ') || 'none'})`,
      }
    }
    return detected.filter(a => opts.agents.includes(a.name)).map(target)
  }

  // No --agent and nothing detected: not an error — guide the user, write nothing.
  if (detected.length === 0) {
    return {
      kind: 'ok',
      text: 'No agents detected (looked for ~/.claude, ~/.codex, ~/.config/opencode).\n'
        + 'Force a directory with `difyctl skills install <dir>`, or print the skill with\n'
        + '`difyctl skills install --stdout`.\n',
      wrote: [],
    }
  }

  return detected.map(target)
}

export async function runSkillsInstall(opts: SkillsInstallOptions): Promise<SkillsInstallResult> {
  const home = opts.home ?? homedir()
  const content = renderSkill({ version: opts.version })

  // --stdout: emit the skill, write nothing.
  if (opts.stdout)
    return { kind: 'ok', text: content, wrote: [] }

  const targets = resolveTargets(opts, home)
  // resolveTargets short-circuits to a terminal result (zero detected / usage).
  if (!Array.isArray(targets))
    return targets

  // Dry-run: list where the skill would land, write nothing.
  if (!opts.write) {
    const lines = targets.map(t => `would write to ${t.name}: ${t.path}`).join('\n')
    return { kind: 'ok', text: `${lines}\n\nRe-run with --yes to write.\n`, wrote: [] }
  }

  const wrote: string[] = []
  for (const target of targets) {
    await writeSkill(content, target.path)
    wrote.push(target.path)
  }
  return { kind: 'ok', text: `${wrote.map(p => `wrote ${p}`).join('\n')}\n`, wrote }
}
