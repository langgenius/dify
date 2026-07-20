import type { SkillsInstallOptions } from './run'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderSkill } from '@/help/skill'
import { runSkillsInstall } from './run'

const VERSION = '9.9.9-test'
const SKILL = renderSkill({ version: VERSION })

describe('runSkillsInstall', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'difyctl-skills-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const opts = (over: Partial<SkillsInstallOptions>): SkillsInstallOptions => ({
    version: VERSION,
    write: false,
    stdout: false,
    agents: [],
    home,
    ...over,
  })

  const claudeTarget = () => join(home, '.claude', 'skills', 'difyctl', 'SKILL.md')

  it('--stdout returns the skill verbatim and writes nothing', async () => {
    expect(await runSkillsInstall(opts({ stdout: true }))).toEqual({
      kind: 'ok',
      text: SKILL,
      wrote: [],
    })
  })

  it('dry-run lists detected agents and writes nothing', async () => {
    await mkdir(join(home, '.claude'))
    const result = await runSkillsInstall(opts({}))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.text).toContain('Detected 1 agent: claude-code')
    expect(result.text).toContain(`would write to claude-code: ${claudeTarget()}`)
    expect(result.text).toContain('Re-run with --yes')
    // A single detected agent: hint the manual-directory escape hatch, but not
    // the subset selector (nothing to subset).
    expect(result.text).toContain('skills install <dir>')
    expect(result.text).not.toContain('--agent')
    expect(result.wrote).toEqual([])
    expect(existsSync(claudeTarget())).toBe(false)
  })

  it('dry-run summarizes detected agents and enumerates --agent names', async () => {
    await mkdir(join(home, '.claude'))
    await mkdir(join(home, '.codex'))
    const result = await runSkillsInstall(opts({}))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    // The detection summary lists the selectable names; the footer just shows the flag.
    expect(result.text).toContain('Detected 2 agents: claude-code, codex')
    expect(result.text).toContain('--agent <name> to write only some')
    expect(result.text).toContain('skills install <dir>')
    expect(result.wrote).toEqual([])
  })

  it('--yes writes the skill and reports the actual path', async () => {
    await mkdir(join(home, '.claude'))
    const result = await runSkillsInstall(opts({ write: true }))
    expect(result).toEqual({
      kind: 'ok',
      text: `wrote ${claudeTarget()}\n`,
      wrote: [claudeTarget()],
    })
    expect(await readFile(claudeTarget(), 'utf8')).toBe(SKILL)
  })

  it('overwrites an existing skill in place', async () => {
    await mkdir(join(home, '.claude', 'skills', 'difyctl'), { recursive: true })
    await writeFile(claudeTarget(), 'stale skill', 'utf8')
    await runSkillsInstall(opts({ write: true }))
    expect(await readFile(claudeTarget(), 'utf8')).toBe(SKILL)
  })

  it('guides the user and writes nothing when no agents are detected', async () => {
    const result = await runSkillsInstall(opts({ write: true }))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.text).toContain('No agents detected')
    expect(result.wrote).toEqual([])
  })

  it('rejects an --agent name that is not detected', async () => {
    await mkdir(join(home, '.claude'))
    const result = await runSkillsInstall(opts({ write: true, agents: ['bogus'] }))
    expect(result.kind).toBe('usage')
    if (result.kind !== 'usage') return
    expect(result.message).toContain('bogus')
  })

  it('rejects --agent for an agent that is not present (none detected)', async () => {
    const result = await runSkillsInstall(opts({ write: true, agents: ['claude-code'] }))
    expect(result.kind).toBe('usage')
  })

  it('[dir] forces a single directory, bypassing detection', async () => {
    const dest = join(home, 'forced')
    const target = join(dest, 'SKILL.md')
    const result = await runSkillsInstall(opts({ write: true, dir: dest }))
    expect(result).toEqual({ kind: 'ok', text: `wrote ${target}\n`, wrote: [target] })
    expect(await readFile(target, 'utf8')).toBe(SKILL)
  })

  it('writes one copy per detected agent', async () => {
    await mkdir(join(home, '.claude'))
    await mkdir(join(home, '.codex'))
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    const result = await runSkillsInstall(opts({ write: true }))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.wrote).toEqual([
      join(home, '.claude', 'skills', 'difyctl', 'SKILL.md'),
      join(home, '.agents', 'skills', 'difyctl', 'SKILL.md'),
      join(home, '.config', 'opencode', 'skills', 'difyctl', 'SKILL.md'),
    ])
  })

  it('narrows writes to the named agent subset', async () => {
    await mkdir(join(home, '.claude'))
    await mkdir(join(home, '.codex'))
    const result = await runSkillsInstall(opts({ write: true, agents: ['codex'] }))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.wrote).toEqual([join(home, '.agents', 'skills', 'difyctl', 'SKILL.md')])
  })

  it('writes cursor and pi to their documented dirs (pi under agent/skills)', async () => {
    await mkdir(join(home, '.cursor'))
    await mkdir(join(home, '.pi'))
    const result = await runSkillsInstall(opts({ write: true }))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.wrote).toEqual([
      join(home, '.cursor', 'skills', 'difyctl', 'SKILL.md'),
      join(home, '.pi', 'agent', 'skills', 'difyctl', 'SKILL.md'),
    ])
    expect(
      await readFile(join(home, '.pi', 'agent', 'skills', 'difyctl', 'SKILL.md'), 'utf8'),
    ).toBe(SKILL)
  })
})
