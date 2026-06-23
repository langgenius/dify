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

describe('findSuggestions — cross-namespace fallback', () => {
  // Mirrors the real command tree shape (auth/login, auth/devices/list, …) so the
  // omitted-namespace cases are deterministic without importing the generated tree.
  const realish: CommandTree = {
    auth: {
      subcommands: {
        login: { command: FooBarCmd, subcommands: {} },
        logout: { command: FooBarCmd, subcommands: {} },
        devices: {
          subcommands: {
            list: { command: FooBarCmd, subcommands: {} },
          },
        },
      },
    },
    describe: { subcommands: { app: { command: FooBarCmd, subcommands: {} } } },
    get: { subcommands: { app: { command: FooBarCmd, subcommands: {} } } },
    create: { subcommands: { member: { command: FooBarCmd, subcommands: {} } } },
    set: { subcommands: { member: { command: FooBarCmd, subcommands: {} } } },
    verbose: { subcommands: { snapshot: { command: FooBarCmd, subcommands: {} } } },
    io: { subcommands: { dir: { command: FooBarCmd, subcommands: {} } } },
  }

  it('recovers an omitted namespace for a bare leaf', () => {
    expect(findSuggestions(realish, ['login'])).toEqual(['auth login'])
  })

  it('does not suggest a leaf outside the length-aware threshold', () => {
    // editDistance('login','logout') = 3 > threshold(2) — logout must not appear.
    expect(findSuggestions(realish, ['login'])).not.toContain('auth logout')
  })

  it('recovers a two-level omitted namespace with one typo', () => {
    // 'list' anchors the leaf; 'device'→'devices' costs 1; 'auth' omitted → score 2.5.
    expect(findSuggestions(realish, ['device', 'list'])).toEqual(['auth devices list'])
  })

  it('recovers a transposed leaf typo the same-level walk cannot fix', () => {
    // editDistance('descrbie','describe') = 2 > traverse's fixed 1, but within length-aware threshold(2).
    expect(findSuggestions(realish, ['descrbie', 'app'])).toEqual(['describe app'])
  })

  it('ranks a same-level fix ahead of any omitted-namespace match', () => {
    // 'descibe' (edit distance 1 to the 'describe' namespace) is fixed in-place by the walk,
    // so the ambiguous omitted-namespace 'app' fan-out never runs.
    const suggestions = findSuggestions(realish, ['descibe', 'app'])
    expect(suggestions[0]).toBe('describe app')
    expect(suggestions).not.toContain('get app')
  })

  it('tolerates a two-edit typo on a long leaf', () => {
    // editDistance('snpashot','snapshot') = 2, leaf length 8 → threshold 2.
    expect(findSuggestions(realish, ['verbose', 'snpashot'])).toContain('verbose snapshot')
  })

  it('keeps short tokens strict and rejects a two-edit neighbor', () => {
    // editDistance('dxx','dir') = 2 > threshold(1) for a 3-char token.
    expect(findSuggestions(realish, ['dxx'])).not.toContain('io dir')
    // editDistance('dxr','dir') = 1 ≤ threshold(1) — the one-edit neighbor is recovered.
    expect(findSuggestions(realish, ['dxr'])).toEqual(['io dir'])
  })

  it('suppresses ambiguous fan-out when a bare leaf lives under many namespaces', () => {
    // 'member' (create/set) and 'app' (describe/get) each tie with zero spelling cost — unroutable.
    expect(findSuggestions(realish, ['member'])).toEqual([])
    expect(findSuggestions(realish, ['app'])).toEqual([])
  })

  it('stays silent when nothing clears the threshold', () => {
    expect(findSuggestions(realish, ['zzzzz'])).toEqual([])
  })

  it('drops a low-confidence two-level omission past the score cutoff', () => {
    // 'list' only reaches the depth-3 'auth devices list' (two namespaces omitted,
    // score 3.0) — beyond the cutoff, so nothing is suggested.
    expect(findSuggestions(realish, ['list'])).toEqual([])
  })

  it('rejects a candidate when more tokens are typed than its path can hold', () => {
    // Three positional tokens cannot align to the two-segment 'describe app'.
    expect(findSuggestions(realish, ['extra', 'descrbie', 'app'])).toEqual([])
  })

  it('produces a deterministic, stable result across runs', () => {
    expect(findSuggestions(realish, ['login'])).toEqual(findSuggestions(realish, ['login']))
    expect(findSuggestions(realish, ['device', 'list'])).toEqual(findSuggestions(realish, ['device', 'list']))
  })
})

describe('findSuggestions — hidden commands', () => {
  class Visible extends Command {
    async run(_argv: string[]) {}
  }
  class Hidden extends Command {
    static hidden = true
    async run(_argv: string[]) {}
  }
  const hiddenTree: CommandTree = {
    status: { command: Visible, subcommands: {} },
    secret: { command: Hidden, subcommands: {} },
  }

  it('never surfaces a hidden command, even for a near typo', () => {
    expect(findSuggestions(hiddenTree, ['secrt'])).toEqual([])
  })

  it('still suggests visible siblings', () => {
    expect(findSuggestions(hiddenTree, ['statuss'])).toEqual(['status'])
  })
})
