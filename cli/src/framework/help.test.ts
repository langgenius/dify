import type { CommandConstructor } from './command'
import type { CommandTree } from './registry'
import { describe, expect, it } from 'vitest'
import { Args, Flags } from './flags'
import { formatHelp, formatTopLevelHelp } from './help'

function makeCmd(opts: {
  description?: string
  flags?: CommandConstructor['flags']
  args?: CommandConstructor['args']
  examples?: string[]
  agentGuide?: string
  effect?: CommandConstructor['effect']
}): CommandConstructor {
  class Cmd {
    static description = opts.description
    static flags = opts.flags ?? {}
    static args = opts.args ?? {}
    static examples = opts.examples ?? []
    static effect = opts.effect
    static agentGuide = opts.agentGuide

    async run(_argv: string[]) {}

    agentGuide(): string {
      return opts.agentGuide ?? ''
    }
  }
  return Cmd as unknown as CommandConstructor
}

describe('formatHelp', () => {
  it('includes description when present', () => {
    const ctor = makeCmd({ description: 'Lists all apps' })
    expect(formatHelp(ctor, 'get app')).toContain('Lists all apps')
  })

  it('omits description section when absent', () => {
    const ctor = makeCmd({})
    const out = formatHelp(ctor, 'get app')
    expect(out).not.toContain('undefined')
  })

  it('includes USAGE line with path and bin', () => {
    const ctor = makeCmd({})
    expect(formatHelp(ctor, 'get app')).toContain('$ difyctl get app')
  })

  it('includes [FLAGS] suffix when flags exist', () => {
    const ctor = makeCmd({ flags: { output: Flags.string({ description: 'format' }) } })
    expect(formatHelp(ctor, 'get app')).toContain('[FLAGS]')
  })

  it('omits [FLAGS] when no flags', () => {
    const ctor = makeCmd({})
    expect(formatHelp(ctor, 'get app')).not.toContain('[FLAGS]')
  })

  it('includes [ARGS] suffix when args exist', () => {
    const ctor = makeCmd({ args: { id: Args.string({ description: 'app id', required: true }) } })
    expect(formatHelp(ctor, 'get app')).toContain('[ARGS]')
  })

  it('omits [ARGS] when no args', () => {
    const ctor = makeCmd({})
    expect(formatHelp(ctor, 'get app')).not.toContain('[ARGS]')
  })

  it('includes FLAGS section with flag description', () => {
    const ctor = makeCmd({
      flags: { output: Flags.string({ description: 'output format', char: 'o' }) },
    })
    const out = formatHelp(ctor, 'get app')
    expect(out).toContain('FLAGS')
    expect(out).toContain('--output')
    expect(out).toContain('-o')
    expect(out).toContain('output format')
  })

  it('includes default value in flag description', () => {
    const ctor = makeCmd({
      flags: { format: Flags.string({ description: 'fmt', default: 'text' }) },
    })
    expect(formatHelp(ctor, 'get app')).toContain('[default: "text"]')
  })

  it('renders boolean flag without <type> placeholder', () => {
    const ctor = makeCmd({
      flags: { verbose: Flags.boolean({ description: 'verbose' }) },
    })
    const out = formatHelp(ctor, 'get app')
    expect(out).toContain('--verbose')
    expect(out).not.toContain('<boolean>')
  })

  it('includes ARGUMENTS section with arg description and required marker', () => {
    const ctor = makeCmd({
      args: { id: Args.string({ description: 'app id', required: true }) },
    })
    const out = formatHelp(ctor, 'get app')
    expect(out).toContain('ARGUMENTS')
    expect(out).toContain('id')
    expect(out).toContain('(required)')
    expect(out).toContain('app id')
  })

  it('omits (required) for optional args', () => {
    const ctor = makeCmd({
      args: { id: Args.string({ description: 'app id' }) },
    })
    expect(formatHelp(ctor, 'get app')).not.toContain('(required)')
  })

  it('includes EXAMPLES section', () => {
    const ctor = makeCmd({ examples: ['difyctl get app my-id'] })
    const out = formatHelp(ctor, 'get app')
    expect(out).toContain('EXAMPLES')
    expect(out).toContain('difyctl get app my-id')
  })

  it('replaces <%= config.bin %> with difyctl in examples', () => {
    const ctor = makeCmd({ examples: ['<%= config.bin %> run app my-id'] })
    const out = formatHelp(ctor, 'run app')
    expect(out).toContain('$ difyctl run app my-id')
    expect(out).not.toContain('<%= config.bin %>')
  })

  it('appends agentGuide string at the end', () => {
    const ctor = makeCmd({ agentGuide: 'WORKFLOW\n  1. do thing\n' })
    const out = formatHelp(ctor, 'run app')
    expect(out).toContain('WORKFLOW')
    expect(out).toContain('1. do thing')
  })

  it('omits agentGuide when absent', () => {
    const ctor = makeCmd({})
    expect(formatHelp(ctor, 'run app')).not.toContain('WORKFLOW')
  })

  it('renders aliases comma-separated and the type after a space', () => {
    const ctor = makeCmd({
      flags: { output: Flags.string({ description: 'fmt', char: 'o' }) },
    })
    const out = formatHelp(ctor, 'get app')
    expect(out).toContain('-o, --output <string>')
    expect(out).not.toContain('--output, <string>')
  })
})

describe('formatHelp structured output', () => {
  it('emits a JSON descriptor under json format', () => {
    const ctor = makeCmd({
      description: 'Lists apps',
      flags: {
        output: Flags.outputFormat({ options: ['json', 'yaml', 'name', 'wide'], default: '' }),
      },
      args: { id: Args.string({ description: 'app id', required: true }) },
      examples: ['<%= config.bin %> get app'],
      agentGuide: 'WORKFLOW',
    })
    const obj = JSON.parse(formatHelp(ctor, 'get app', 'json'))
    expect(obj.command).toBe('get app')
    expect(obj.description).toBe('Lists apps')
    expect(obj.flags[0]).toMatchObject({ name: 'output', char: 'o', type: 'string' })
    expect(obj.flags[0].options).toEqual(['json', 'yaml', 'name', 'wide'])
    expect(obj.args[0]).toMatchObject({ name: 'id', required: true })
    expect(obj.examples).toEqual(['difyctl get app'])
    expect(obj.agentGuide).toBe('WORKFLOW')
  })

  it('sets a flag options to null when the flag has no enum constraint', () => {
    const ctor = makeCmd({
      flags: { name: Flags.string({ description: 'a name' }) },
    })
    const obj = JSON.parse(formatHelp(ctor, 'get app', 'json'))
    expect(obj.flags[0].options).toBeNull()
  })

  it('sets agentGuide to null when absent', () => {
    const obj = JSON.parse(formatHelp(makeCmd({}), 'get app', 'json'))
    expect(obj.agentGuide).toBeNull()
  })

  it('defaults effect to read when unset', () => {
    const obj = JSON.parse(formatHelp(makeCmd({}), 'get app', 'json'))
    expect(obj.effect).toBe('read')
  })

  it('carries an explicit effect through to the descriptor', () => {
    const obj = JSON.parse(formatHelp(makeCmd({ effect: 'destructive' }), 'delete member', 'json'))
    expect(obj.effect).toBe('destructive')
  })
})

describe('formatTopLevelHelp', () => {
  it('emits bin, contract, commands and topics as a JSON site map', () => {
    const tree: CommandTree = {
      get: { subcommands: { app: { command: makeCmd({ description: 'apps' }), subcommands: {} } } },
    }
    const obj = JSON.parse(formatTopLevelHelp(tree, 'json'))
    expect(obj.bin).toBe('difyctl')
    expect(obj.contract.exitCodes['0']).toBeDefined()
    expect(obj.contract.outputFormats).toContain('json')
    expect(obj.commands.some((c: { command: string }) => c.command === 'get app')).toBe(true)
    expect(obj.commands.every((c: { effect?: string }) => typeof c.effect === 'string')).toBe(true)
    expect(obj.topics.map((t: { name: string }) => t.name)).toContain('account')
  })
})
