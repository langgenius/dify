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
    await mkdir(join(home, '.cursor'))
    await mkdir(join(home, '.pi'))
    expect(detectAgents(home).map(a => a.name)).toEqual(['claude-code', 'codex', 'opencode', 'cursor', 'pi'])
  })

  it('detects cursor and pi by their config dirs', async () => {
    await mkdir(join(home, '.cursor'))
    await mkdir(join(home, '.pi'))
    expect(detectAgents(home).map(a => a.name)).toEqual(['cursor', 'pi'])
  })
})

describe('agent registry paths', () => {
  const home = join('home', 'dev')

  it('installs Codex skills under ~/.agents/skills, detected via ~/.codex', () => {
    const codex = AGENTS.find(a => a.name === 'codex')
    expect(codex?.probeDir(home)).toBe(join(home, '.codex'))
    expect(codex?.skillDir(home)).toBe(join(home, '.agents', 'skills', 'difyctl'))
  })

  it('installs Claude Code and opencode skills under their native dirs', () => {
    const claude = AGENTS.find(a => a.name === 'claude-code')
    const opencode = AGENTS.find(a => a.name === 'opencode')
    expect(claude?.skillDir(home)).toBe(join(home, '.claude', 'skills', 'difyctl'))
    expect(opencode?.skillDir(home)).toBe(join(home, '.config', 'opencode', 'skills', 'difyctl'))
  })

  it('installs Cursor under ~/.cursor/skills, detected via ~/.cursor', () => {
    const cursor = AGENTS.find(a => a.name === 'cursor')
    expect(cursor?.probeDir(home)).toBe(join(home, '.cursor'))
    expect(cursor?.skillDir(home)).toBe(join(home, '.cursor', 'skills', 'difyctl'))
  })

  it('installs pi under ~/.pi/agent/skills, detected via ~/.pi', () => {
    const pi = AGENTS.find(a => a.name === 'pi')
    expect(pi?.probeDir(home)).toBe(join(home, '.pi'))
    expect(pi?.skillDir(home)).toBe(join(home, '.pi', 'agent', 'skills', 'difyctl'))
  })
})
