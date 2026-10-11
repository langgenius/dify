import { expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { Command } from './command'
import { commandRow } from './describe'

const INPUT = z.object({ id: z.string().describe('The id'), dry_run: z.boolean().default(false) })

class Fake extends Command<typeof INPUT> {
  static override summary = 'Do a thing'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['id'] as const
  static override examples = [{ title: 'Basic', input: { id: 'x' } }]
  async run() {
    return undefined
  }
}

it('renders the row from the statics with a JSON Schema input', () => {
  const row = commandRow(Fake, ['fake', 'thing'])
  expect(row).toMatchObject({
    id: 'fake thing',
    usage: 'difyctl fake thing <id> [flags]',
    summary: 'Do a thing',
    effect: 'write',
    positional: ['id'],
    examples: [{ title: 'Basic', input: { id: 'x' } }],
  })
  expect(row.input).toMatchObject({
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The id' },
      dry_run: { type: 'boolean', default: false },
    },
  })
})

class OverridesSchema extends Command {
  static override summary = 'Custom schema'
  static override schema() {
    return { type: 'object', properties: { x: { type: 'string' } } }
  }

  async run() {
    return undefined
  }
}

it('renders the row from a static schema() override', () => {
  const row = commandRow(OverridesSchema, ['custom'])
  expect(row.input).toEqual({ type: 'object', properties: { x: { type: 'string' } } })
  expect(row.usage).toMatch(/\[flags\]$/)
})
