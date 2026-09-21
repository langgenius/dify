import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { commandTree } from '@/commands/tree'
import { resolveCommand } from '@/plugins/commands/registry'
import { renderSkill, SKILL_TEMPLATE } from './template'

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/catalog.json'), 'utf8'),
) as { ops: Record<string, unknown> }

const OP_ID_RE = /[a-z_]+(?:\.[a-z_]+)+/g

// The op ids the skill actually mentions, from the four run ops and console_app.describe
// (the "run an app" paragraph) — the only dotted tokens in the text that also name a real
// catalog op. `file.json` and `r.pdf` match the same regex but are --input examples, not
// op ids, so the catalog-membership filter drops them.
const NAMED_OPS = new Set([
  'console_app.workflow.run',
  'console_app.chat.run',
  'console_app.advanced_chat.run',
  'console_app.completion.run',
  'console_app.describe',
])

const NAMED_STATIC_COMMANDS = [
  ['ops'],
  ['ops', 'describe'],
  ['call'],
  ['login'],
  ['workspace', 'list'],
  ['workspace', 'use'],
  ['cache', 'refresh'],
]

describe('SKILL_TEMPLATE', () => {
  it('renders the version and leaves no placeholder unfilled', () => {
    const rendered = renderSkill({ version: '1.2.3' })
    expect(rendered).toContain('difyctl 1.2.3')
    expect(rendered).toContain('## The three steps')
    expect(rendered).not.toContain('{{')
  })

  it('names only real catalog op ids, and only the ones it teaches', () => {
    const catalogOpIds = new Set(Object.keys(FIXTURE.ops))
    const tokens = SKILL_TEMPLATE.match(OP_ID_RE) ?? []
    const namedOps = new Set(tokens.filter((token) => catalogOpIds.has(token)))
    expect(namedOps).toEqual(NAMED_OPS)
  })

  it('names only static commands that exist in the generated tree (drift guard)', () => {
    for (const path of NAMED_STATIC_COMMANDS) {
      expect(resolveCommand(commandTree, path)?.path).toEqual(path)
    }
  })
})
