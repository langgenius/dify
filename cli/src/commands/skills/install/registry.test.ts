import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENTS, detectAgents } from './registry'

describe('detectAgents', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'difyctl-detect-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('detects nothing in an empty home', () => {
    expect(detectAgents(home)).toEqual([])
  })

  it('detects an agent once its config dir exists', async () => {
    await mkdir(join(home, '.codex'))
    expect(detectAgents(home).map(a => a.name)).toEqual(['codex'])
  })

  it('detects every agent whose config dir exists, in registry order', async () => {
    await mkdir(join(home, '.claude'))
    await mkdir(join(home, '.codex'))
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    expect(detectAgents(home).map(a => a.name)).toEqual(['claude-code', 'codex', 'opencode'])
  })
})

describe('agent registry paths', () => {
  it('installs Codex skills under ~/.agents/skills, detected via ~/.codex', () => {
    const codex = AGENTS.find(a => a.name === 'codex')
    expect(codex?.probeDir('/home/dev')).toBe('/home/dev/.codex')
    expect(codex?.skillDir('/home/dev')).toBe('/home/dev/.agents/skills/difyctl')
  })

  it('installs Claude Code and opencode skills under their native dirs', () => {
    const claude = AGENTS.find(a => a.name === 'claude-code')
    const opencode = AGENTS.find(a => a.name === 'opencode')
    expect(claude?.skillDir('/home/dev')).toBe('/home/dev/.claude/skills/difyctl')
    expect(opencode?.skillDir('/home/dev')).toBe('/home/dev/.config/opencode/skills/difyctl')
  })
})
