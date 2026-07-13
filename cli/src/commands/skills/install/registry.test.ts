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
    expect(detectAgents(home).map((a) => a.name)).toEqual(['codex'])
  })

  it('detects every agent whose config dir exists, in registry order', async () => {
    await mkdir(join(home, '.claude'))
    await mkdir(join(home, '.codex'))
    await mkdir(join(home, '.config', 'opencode'), { recursive: true })
    await mkdir(join(home, '.cursor'))
    await mkdir(join(home, '.pi'))
    await mkdir(join(home, '.config', 'amp'), { recursive: true })
    await mkdir(join(home, '.openclaw'))
    await mkdir(join(home, '.qoder'))
    await mkdir(join(home, '.codeium', 'windsurf'), { recursive: true })
    await mkdir(join(home, '.hermes'))
    expect(detectAgents(home).map((a) => a.name)).toEqual([
      'claude-code',
      'codex',
      'opencode',
      'cursor',
      'pi',
      'amp',
      'openclaw',
      'qoder',
      'windsurf',
      'hermes',
    ])
  })

  it('detects cursor and pi by their config dirs', async () => {
    await mkdir(join(home, '.cursor'))
    await mkdir(join(home, '.pi'))
    expect(detectAgents(home).map((a) => a.name)).toEqual(['cursor', 'pi'])
  })
})

describe('agent registry paths', () => {
  const home = join('home', 'dev')

  it('installs Codex skills under ~/.agents/skills, detected via ~/.codex', () => {
    const codex = AGENTS.find((a) => a.name === 'codex')
    expect(codex?.probeDir(home)).toBe(join(home, '.codex'))
    expect(codex?.skillDir(home)).toBe(join(home, '.agents', 'skills', 'difyctl'))
  })

  it('installs Claude Code and opencode skills under their native dirs', () => {
    const claude = AGENTS.find((a) => a.name === 'claude-code')
    const opencode = AGENTS.find((a) => a.name === 'opencode')
    expect(claude?.skillDir(home)).toBe(join(home, '.claude', 'skills', 'difyctl'))
    expect(opencode?.skillDir(home)).toBe(join(home, '.config', 'opencode', 'skills', 'difyctl'))
  })

  it('installs Cursor under ~/.cursor/skills, detected via ~/.cursor', () => {
    const cursor = AGENTS.find((a) => a.name === 'cursor')
    expect(cursor?.probeDir(home)).toBe(join(home, '.cursor'))
    expect(cursor?.skillDir(home)).toBe(join(home, '.cursor', 'skills', 'difyctl'))
  })

  it('installs pi under ~/.pi/agent/skills, detected via ~/.pi', () => {
    const pi = AGENTS.find((a) => a.name === 'pi')
    expect(pi?.probeDir(home)).toBe(join(home, '.pi'))
    expect(pi?.skillDir(home)).toBe(join(home, '.pi', 'agent', 'skills', 'difyctl'))
  })

  it('installs Amp into shared ~/.agents/skills, detected via ~/.config/amp', () => {
    const amp = AGENTS.find((a) => a.name === 'amp')
    expect(amp?.probeDir(home)).toBe(join(home, '.config', 'amp'))
    expect(amp?.skillDir(home)).toBe(join(home, '.agents', 'skills', 'difyctl'))
  })

  it('installs OpenClaw into shared ~/.agents/skills, detected via ~/.openclaw', () => {
    const openclaw = AGENTS.find((a) => a.name === 'openclaw')
    expect(openclaw?.probeDir(home)).toBe(join(home, '.openclaw'))
    expect(openclaw?.skillDir(home)).toBe(join(home, '.agents', 'skills', 'difyctl'))
  })

  it('installs Qoder under ~/.qoder/skills, detected via ~/.qoder', () => {
    const qoder = AGENTS.find((a) => a.name === 'qoder')
    expect(qoder?.probeDir(home)).toBe(join(home, '.qoder'))
    expect(qoder?.skillDir(home)).toBe(join(home, '.qoder', 'skills', 'difyctl'))
  })

  it('installs Windsurf under ~/.codeium/windsurf/skills, detected via ~/.codeium/windsurf', () => {
    const windsurf = AGENTS.find((a) => a.name === 'windsurf')
    expect(windsurf?.probeDir(home)).toBe(join(home, '.codeium', 'windsurf'))
    expect(windsurf?.skillDir(home)).toBe(join(home, '.codeium', 'windsurf', 'skills', 'difyctl'))
  })

  it('installs Hermes under ~/.hermes/skills, detected via ~/.hermes', () => {
    const hermes = AGENTS.find((a) => a.name === 'hermes')
    expect(hermes?.probeDir(home)).toBe(join(home, '.hermes'))
    expect(hermes?.skillDir(home)).toBe(join(home, '.hermes', 'skills', 'difyctl'))
  })

  it('codex, amp and openclaw share one skillDir (the ~/.agents/skills convention)', () => {
    const shared = ['codex', 'amp', 'openclaw'].map((name) =>
      AGENTS.find((a) => a.name === name)?.skillDir(home),
    )
    expect(new Set(shared).size).toBe(1)
    expect(shared[0]).toBe(join(home, '.agents', 'skills', 'difyctl'))
  })
})
