import type { CommandTree } from './registry'
import { describe, expect, it } from 'vitest'
import { Command } from './command'
import { findSuggestions, resolveCommand } from './registry'

class FooCmd extends Command {
  async run(_argv: string[]) {}
}
class FooBarCmd extends Command {
  async run(_argv: string[]) {}
}
class FooBazCmd extends Command {
  async run(_argv: string[]) {}
}
class TopLevelCmd extends Command {
  async run(_argv: string[]) {}
}

const tree: CommandTree = {
  foo: {
    command: undefined,
    subcommands: {
      bar: { command: FooBarCmd, subcommands: {} },
      baz: { command: FooBazCmd, subcommands: {} },
    },
  },
  top: {
    command: TopLevelCmd,
    subcommands: {},
  },
  nested: {
    command: FooCmd,
    subcommands: {
      deep: { command: FooBarCmd, subcommands: {} },
    },
  },
}

describe('resolveCommand', () => {
  it('resolves a leaf subcommand', () => {
    const result = resolveCommand(tree, ['foo', 'bar'])
    expect(result?.command).toBe(FooBarCmd)
    expect(result?.path).toEqual(['foo', 'bar'])
  })

  it('resolves another leaf subcommand', () => {
    const result = resolveCommand(tree, ['foo', 'baz'])
    expect(result?.command).toBe(FooBazCmd)
    expect(result?.path).toEqual(['foo', 'baz'])
  })

  it('resolves a top-level command', () => {
    const result = resolveCommand(tree, ['top'])
    expect(result?.command).toBe(TopLevelCmd)
    expect(result?.path).toEqual(['top'])
  })

  it('returns undefined for unknown top-level token', () => {
    const result = resolveCommand(tree, ['unknown'])
    expect(result).toBeUndefined()
  })

  it('returns undefined for unknown subcommand', () => {
    const result = resolveCommand(tree, ['foo', 'nope'])
    expect(result).toBeUndefined()
  })

  it('returns undefined for empty argv', () => {
    const result = resolveCommand(tree, [])
    expect(result).toBeUndefined()
  })

  it('ignores flag tokens during path traversal', () => {
    const result = resolveCommand(tree, ['foo', '--verbose', 'bar'])
    expect(result).toBeUndefined()
  })

  it('strips remaining argv (flags/args) from path', () => {
    const result = resolveCommand(tree, ['foo', 'bar', '--output', 'json'])
    expect(result?.path).toEqual(['foo', 'bar'])
  })

  it('prefers deeper subcommand over parent command', () => {
    const result = resolveCommand(tree, ['nested', 'deep'])
    expect(result?.command).toBe(FooBarCmd)
    expect(result?.path).toEqual(['nested', 'deep'])
  })

  it('resolves parent command when subcommand token is not in subcommands', () => {
    const result = resolveCommand(tree, ['nested', 'unknown'])
    expect(result?.command).toBe(FooCmd)
    expect(result?.path).toEqual(['nested'])
  })
})

describe('findSuggestions', () => {
  it('returns empty for token with edit distance > 1 to all commands', () => {
    const suggestions = findSuggestions(tree, ['xyz'])
    expect(suggestions).toHaveLength(0)
  })

  it('suggests softly matched top-level command', () => {
    const suggestions = findSuggestions(tree, ['tpp'])
    expect(suggestions).toEqual(['top'])
  })

  it('suggests softly matched subcommand under exact parent', () => {
    const suggestions = findSuggestions(tree, ['foo', 'br'])
    expect(suggestions).toEqual(['foo bar'])
  })

  it('returns all subcommands when multiple soft-match at the same level', () => {
    const suggestions = findSuggestions(tree, ['foo', 'bax'])
    expect(suggestions).toEqual(expect.arrayContaining(['foo bar', 'foo baz']))
  })

  it('collects leaf command when trailing positional args remain', () => {
    const suggestions = findSuggestions(tree, ['foo', 'br', 'some-arg'])
    expect(suggestions).toEqual(['foo bar'])
  })

  it('returns empty when subcommand token has edit distance > 1', () => {
    const suggestions = findSuggestions(tree, ['foo', 'unknown'])
    expect(suggestions).toHaveLength(0)
  })

  it('returns available subcommands when given valid parent with no further tokens', () => {
    const suggestions = findSuggestions(tree, ['foo'])
    expect(suggestions).toEqual(expect.arrayContaining(['foo bar', 'foo baz']))
  })

  it('collects exact-matched leaf with trailing tokens as positional args', () => {
    const suggestions = findSuggestions(tree, ['top', 'sub', 'unknown'])
    expect(suggestions).toEqual(['top'])
  })

  it('stops at flag token', () => {
    const suggestions = findSuggestions(tree, ['--help'])
    expect(suggestions).toHaveLength(0)
  })
})
