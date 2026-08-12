import { describe, expect, it } from 'vitest'
import { commandTree } from '@/commands/tree.generated'
import { collectCommands } from '@/framework/registry'
import { versionInfo } from '@/version/info'
import { renderSkill } from './skill'
import { SKILL_TEMPLATE } from './skill-template'

// Self-references the skill is allowed to name — operational pointers, not a
// command listing. Everything else must be discovered via `help -o json`.
const SELF_REFERENCES = new Set(['resume app', 'skills install', 'version'])

describe('renderSkill', () => {
  it('substitutes the version stamp and changes nothing else', () => {
    expect(renderSkill({ version: '9.9.9-test' })).toBe(
      SKILL_TEMPLATE.replaceAll('{{VERSION}}', '9.9.9-test'),
    )
  })

  it('stamps the running binary version (deterministic under test setup)', () => {
    expect(versionInfo.version).toBe('0.0.0-test')
    expect(renderSkill({ version: versionInfo.version })).toContain('difyctl skill v0.0.0-test')
  })

  it('leaves no unfilled template tokens', () => {
    expect(renderSkill({ version: versionInfo.version })).not.toContain('{{')
  })

  it('points at the machine-readable surface instead of inlining it', () => {
    expect(renderSkill({ version: versionInfo.version })).toContain('difyctl help -o json')
  })

  it('enumerates no command from the tree (zero drift surface)', () => {
    const skill = renderSkill({ version: versionInfo.version })
    for (const { path } of collectCommands(commandTree)) {
      const command = path.join(' ')
      if (SELF_REFERENCES.has(command)) continue
      expect(skill, `skill must not enumerate command "${command}"`).not.toContain(command)
    }
  })

  it('carries none of the old enumerated sections', () => {
    const skill = renderSkill({ version: versionInfo.version })
    for (const marker of [
      '## Safety',
      '## Core workflow',
      '## Reference',
      'OUTPUT FORMATS',
      'EXIT CODES',
      'reference/',
    ])
      expect(skill).not.toContain(marker)
  })

  it('inlines no command-specific flags (only the --help pointer)', () => {
    const skill = renderSkill({ version: versionInfo.version })
    const longFlags = skill.match(/--[a-z][\w-]+/g) ?? []
    for (const flag of longFlags) expect(flag, `unexpected flag in skill: ${flag}`).toBe('--help')
  })
})
