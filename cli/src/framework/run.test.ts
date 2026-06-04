import type { CommandConstructor } from './command'
import type { CommandTree } from './registry'
import { describe, expect, it } from 'vitest'
import { BaseError, HttpClientError, newError } from '@/errors/base'
import { ErrorCode, ExitCode } from '@/errors/codes'
import { CONTRACT } from '@/help/contract'
import { Command } from './command'
import { run, sniffOutputFormat } from './run'

describe('sniffOutputFormat', () => {
  it('returns empty for empty argv', () => {
    expect(sniffOutputFormat([])).toBe('')
  })

  it('returns empty when no output flag present', () => {
    expect(sniffOutputFormat(['cmd'])).toBe('')
    expect(sniffOutputFormat(['cmd', 'pos', '--flag'])).toBe('')
  })

  it('parses --output=value', () => {
    expect(sniffOutputFormat(['cmd', '--output=json'])).toBe('json')
  })

  it('parses --output value (space form)', () => {
    expect(sniffOutputFormat(['cmd', '--output', 'json'])).toBe('json')
  })

  it('parses -o value (space form)', () => {
    expect(sniffOutputFormat(['cmd', '-o', 'yaml'])).toBe('yaml')
  })

  it('parses -o=value', () => {
    expect(sniffOutputFormat(['cmd', '-o=text'])).toBe('text')
  })

  it('returns empty when next token after space-form is itself a flag', () => {
    expect(sniffOutputFormat(['cmd', '-o', '--other'])).toBe('')
    expect(sniffOutputFormat(['cmd', '--output', '--other'])).toBe('')
  })

  it('stops at end-of-flags marker --', () => {
    expect(sniffOutputFormat(['cmd', '--', '-o', 'json'])).toBe('')
    expect(sniffOutputFormat(['cmd', '--', '--output=json'])).toBe('')
  })

  it('first occurrence wins on duplicate flags', () => {
    expect(sniffOutputFormat(['cmd', '--output=json', '--output=yaml'])).toBe('json')
  })

  it('does NOT support concatenated short form -o<val>', () => {
    expect(sniffOutputFormat(['cmd', '-ojson'])).toBe('')
  })
})

type Captured = {
  stdout: string
  stderr: string
  exit: number | undefined
}

async function captureRun(tree: CommandTree, argv: string[]): Promise<Captured> {
  const captured: Captured = { stdout: '', stderr: '', exit: undefined }
  const origStdout = process.stdout.write.bind(process.stdout)
  const origStderr = process.stderr.write.bind(process.stderr)
  const origExit = process.exit.bind(process)

  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stdout.write

  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stderr.write

  process.exit = ((code?: number) => {
    captured.exit = code
    // do not throw; the catch block should `return` after exit
  }) as typeof process.exit

  try {
    await run(tree, argv)
  }
  finally {
    process.stdout.write = origStdout
    process.stderr.write = origStderr
    process.exit = origExit
  }
  return captured
}

function makeTree(cmd: CommandConstructor): CommandTree {
  return { cmd: { command: cmd, subcommands: {} } }
}

describe('run() catch routing', () => {
  it('routes BaseError to human format with semantic exit code', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw new BaseError({
          code: ErrorCode.NotLoggedIn,
          message: 'not logged in',
          hint: 'run `difyctl auth login` to authenticate',
        })
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd'])
    expect(result.stderr).toBe(
      'not_logged_in: not logged in\nhint: run `difyctl auth login` to authenticate\n',
    )
    expect(result.exit).toBe(ExitCode.Auth)
    expect(result.stdout).toBe('')
  })

  it('routes BaseError to JSON envelope with --output=json', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw new BaseError({
          code: ErrorCode.NotLoggedIn,
          message: 'not logged in',
          hint: 'run `difyctl auth login` to authenticate',
        })
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd', '--output=json'])
    expect(result.stderr).toBe(
      `${JSON.stringify({
        error: {
          code: 'not_logged_in',
          message: 'not logged in',
          hint: 'run `difyctl auth login` to authenticate',
        },
      })}\n`,
    )
    expect(result.exit).toBe(ExitCode.Auth)
  })

  it('routes BaseError to JSON envelope with -o json (space form)', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw newError(ErrorCode.NotLoggedIn, 'not logged in')
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd', '-o', 'json'])
    expect(result.stderr).toContain('"code":"not_logged_in"')
    expect(result.stderr.startsWith('{')).toBe(true)
    expect(result.exit).toBe(ExitCode.Auth)
  })

  it('keeps human format when -- separates positional from --output', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw newError(ErrorCode.NotLoggedIn, 'not logged in')
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd', '--', '--output=json'])
    expect(result.stderr.startsWith('not_logged_in:')).toBe(true)
  })

  it('routes Usage error to exit code 2 with code prefix', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw newError(ErrorCode.UsageInvalidFlag, 'bad flag')
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd'])
    expect(result.stderr).toBe('usage_invalid_flag: bad flag\n')
    expect(result.exit).toBe(ExitCode.Usage)
  })

  it('routes Server5xx error with http_status line and generic exit', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw HttpClientError.from(newError(ErrorCode.Server5xx, 'upstream boom')).withHttpStatus(502)
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd'])
    expect(result.stderr).toBe('server_5xx: upstream boom\nhttp_status: 502\n')
    expect(result.exit).toBe(ExitCode.Generic)
  })

  it('renders request line and http_status when both are present', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw HttpClientError.from(newError(ErrorCode.Server5xx, 'upstream boom'))
          .withRequest('GET', 'https://api.dify.ai/v1/me')
          .withHttpStatus(502)
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd'])
    expect(result.stderr).toBe(
      'server_5xx: upstream boom\nrequest: GET https://api.dify.ai/v1/me\nhttp_status: 502\n',
    )
    expect(result.exit).toBe(ExitCode.Generic)
  })

  it('serializes method and url in JSON envelope', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw HttpClientError.from(newError(ErrorCode.Server4xxOther, 'not found'))
          .withRequest('GET', 'https://api.dify.ai/v1/apps/x')
          .withHttpStatus(404)
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd', '--output=json'])
    const envelope = JSON.parse(result.stderr.trim())
    expect(envelope.error.method).toBe('GET')
    expect(envelope.error.url).toBe('https://api.dify.ai/v1/apps/x')
    expect(envelope.error.http_status).toBe(404)
    expect(envelope.error.code).toBe('server_4xx_other')
    expect(result.exit).toBe(ExitCode.Generic)
  })

  it('falls through to generic Error branch and exits 1', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        throw new Error('oops')
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd'])
    expect(result.stderr).toBe('oops\n')
    expect(result.exit).toBe(1)
  })

  it('handles non-Error throw via String() coercion', async () => {
    class Throwing extends Command {
      async run(_argv: string[]) {
        // eslint-disable-next-line no-throw-literal
        throw 'plain string'
      }
    }
    const result = await captureRun(makeTree(Throwing), ['cmd'])
    expect(result.stderr).toBe('plain string\n')
    expect(result.exit).toBe(1)
  })

  it('does not call process.exit when command runs successfully', async () => {
    class Ok extends Command {
      async run(_argv: string[]) {
        // returning void → run() does not write to stdout
      }
    }
    const result = await captureRun({ cmd: { command: Ok, subcommands: {} } }, ['cmd'])
    expect(result.stderr).toBe('')
    expect(result.exit).toBeUndefined()
  })

  it('routes BaseError thrown from constructor through catch with JSON envelope', async () => {
    class CtorBang extends Command {
      constructor() {
        super()
        throw newError(ErrorCode.Unknown, 'ctor-bang')
      }

      async run(_argv: string[]) {}
    }
    const result = await captureRun(
      { cmd: { command: CtorBang, subcommands: {} } },
      ['cmd', '--output=json'],
    )
    expect(result.stderr).toContain('"code":"unknown"')
    expect(result.stderr).toContain('"message":"ctor-bang"')
    expect(result.exit).toBe(ExitCode.Generic)
  })
})

describe('hidden commands', () => {
  it('omits a hidden top-level command from printTopLevelHelp', async () => {
    class Visible extends Command {
      static override description = 'visible cmd'
      async run() {}
    }
    class Hidden extends Command {
      static override description = 'hidden cmd'
      static hidden = true
      async run() {}
    }
    const tree: CommandTree = {
      'visible': { command: Visible, subcommands: {} },
      'secret-debug': { command: Hidden, subcommands: {} },
    }
    const result = await captureRun(tree, [])
    expect(result.stdout).toContain('visible')
    expect(result.stdout).not.toContain('secret-debug')
  })

  it('omits a hidden subcommand from its topic listing', async () => {
    class Public extends Command {
      static override description = 'visible sub'
      async run() {}
    }
    class HiddenSub extends Command {
      static override description = 'hidden sub'
      static hidden = true
      async run() {}
    }
    const tree: CommandTree = {
      topic: {
        subcommands: {
          'public': { command: Public, subcommands: {} },
          'debug-only': { command: HiddenSub, subcommands: {} },
        },
      },
    }
    const result = await captureRun(tree, [])
    expect(result.stdout).toContain('public')
    expect(result.stdout).not.toContain('debug-only')
  })

  it('still resolves and executes a hidden command when invoked directly', async () => {
    let ran = false
    class Hidden extends Command {
      static hidden = true
      async run() { ran = true }
    }
    const tree: CommandTree = {
      'secret-debug': { command: Hidden, subcommands: {} },
    }
    await captureRun(tree, ['secret-debug'])
    expect(ran).toBe(true)
  })
})

describe('deprecated commands', () => {
  it('prints a deprecation warning to stderr before running', async () => {
    class Old extends Command {
      static deprecated = 'use `difyctl run app` instead; removal in 2.0'
      async run() {
        process.stdout.write('old-ran\n')
      }
    }
    const tree: CommandTree = {
      old: { command: Old, subcommands: {} },
    }
    const result = await captureRun(tree, ['old'])
    expect(result.stderr).toBe(
      'deprecated: use `difyctl run app` instead; removal in 2.0\n',
    )
    expect(result.stdout).toBe('old-ran\n')
    expect(result.exit).toBeUndefined()
  })

  it('does not print a warning when deprecated is unset', async () => {
    class Fresh extends Command {
      async run() {}
    }
    const tree: CommandTree = {
      fresh: { command: Fresh, subcommands: {} },
    }
    const result = await captureRun(tree, ['fresh'])
    expect(result.stderr).toBe('')
  })
})

describe('run() help routing', () => {
  class GetApp extends Command {
    static override description = 'List or get apps'
    async run() {}
  }

  const tree: CommandTree = {
    get: { subcommands: { app: { command: GetApp, subcommands: {} } } },
  }

  it('renders a concept guide for `help <topic>`', async () => {
    const result = await captureRun(tree, ['help', 'account'])
    expect(result.stdout).toContain('account-bearer onboarding')
    expect(result.stdout).toContain('difyctl auth login')
    expect(result.stdout).not.toContain('COMMANDS')
    expect(result.exit).toBeUndefined()
  })

  it('renders the environment guide for `help environment`', async () => {
    const result = await captureRun(tree, ['help', 'environment'])
    expect(result.stdout).toContain('ENVIRONMENT VARIABLES')
  })

  it('renders per-command help for `help <cmd...>`', async () => {
    const result = await captureRun(tree, ['help', 'get', 'app'])
    expect(result.stdout).toContain('List or get apps')
    expect(result.stdout).toContain('USAGE')
    expect(result.exit).toBeUndefined()
  })

  it('suggests and exits non-zero for an unknown help topic', async () => {
    const result = await captureRun(tree, ['help', 'xyz'])
    expect(result.stderr).toContain('unknown help topic: xyz')
    expect(result.exit).toBe(1)
  })

  it('lists USAGE, COMMANDS, EXAMPLES, GLOBAL FLAGS, GUIDES and LEARN MORE in the top-level overview', async () => {
    const result = await captureRun(tree, ['help'])
    expect(result.stdout).toContain('USAGE')
    expect(result.stdout).toContain('COMMANDS')
    expect(result.stdout).toContain('EXAMPLES')
    expect(result.stdout).toContain('GLOBAL FLAGS')
    expect(result.stdout).toContain('GUIDES')
    expect(result.stdout).toContain('LEARN MORE')
    expect(result.stdout).toContain('account')
    expect(result.stdout).toContain('environment')
    expect(result.stdout).toContain('external')
  })

  it('derives the GLOBAL FLAGS output format list from the contract', async () => {
    const result = await captureRun(tree, ['help'])
    expect(result.stdout).toContain('-o, --output')
    expect(result.stdout).toContain(`Output format: ${CONTRACT.outputFormats.join('|')}`)
    expect(result.stdout).toContain('--http-retry')
  })

  it('does not print trailing whitespace on group rows', async () => {
    const groupTree: CommandTree = {
      auth: { subcommands: { devices: { subcommands: { list: { command: GetApp, subcommands: {} } } } } },
    }
    const result = await captureRun(groupTree, ['help'])
    expect(result.stdout).not.toMatch(/ \n/)
  })

  it('emits a JSON site map for `help -o json`', async () => {
    const result = await captureRun(tree, ['help', '-o', 'json'])
    const obj = JSON.parse(result.stdout)
    expect(obj.bin).toBe('difyctl')
    expect(obj.contract.exitCodes).toBeDefined()
    expect(obj.commands.some((c: { command: string }) => c.command === 'get app')).toBe(true)
    expect(obj.topics.some((t: { name: string }) => t.name === 'account')).toBe(true)
    expect(result.exit).toBeUndefined()
  })

  it('emits a JSON descriptor for `help <cmd> -o json`', async () => {
    const result = await captureRun(tree, ['help', 'get', 'app', '-o', 'json'])
    const obj = JSON.parse(result.stdout)
    expect(obj.command).toBe('get app')
    expect(Array.isArray(obj.flags)).toBe(true)
  })

  class Login extends Command {
    static override description = 'Sign in'
    async run() {}
  }

  class DevicesList extends Command {
    static override description = 'List sessions'
    async run() {}
  }

  class DevicesRevoke extends Command {
    static override description = 'Revoke a session'
    async run() {}
  }

  const groupTree: CommandTree = {
    auth: {
      subcommands: {
        login: { command: Login, subcommands: {} },
        devices: {
          subcommands: {
            list: { command: DevicesList, subcommands: {} },
            revoke: { command: DevicesRevoke, subcommands: {} },
          },
        },
      },
    },
  }

  it('drills into a namespace node for `<group> --help` instead of erroring', async () => {
    const result = await captureRun(groupTree, ['auth', '--help'])
    expect(result.stdout).toContain('auth login')
    expect(result.stdout).toContain('auth devices list')
    expect(result.stdout).toContain('auth devices revoke')
    expect(result.stderr).not.toContain('unknown help topic')
    expect(result.exit).toBeUndefined()
  })

  it('drills into a nested namespace node for `<group> <sub> --help`', async () => {
    const result = await captureRun(groupTree, ['auth', 'devices', '--help'])
    expect(result.stdout).toContain('auth devices list')
    expect(result.stdout).toContain('auth devices revoke')
    expect(result.stdout).not.toContain('auth login')
    expect(result.stderr).not.toContain('unknown help topic')
    expect(result.exit).toBeUndefined()
  })

  it('still errors for an unknown namespace-looking path', async () => {
    const result = await captureRun(groupTree, ['auth', 'nope', '--help'])
    expect(result.stderr).toContain('unknown help topic: auth nope')
    expect(result.exit).toBe(1)
  })

  it('serializes the subtree as JSON for `<group> --help -o json`', async () => {
    const result = await captureRun(groupTree, ['auth', '--help', '-o', 'json'])
    expect(result.exit).toBeUndefined()
    expect(result.stdout).not.toContain('COMMANDS')
    const parsed = JSON.parse(result.stdout) as { commands: Array<{ command: string }> }
    expect(parsed.commands.map(c => c.command)).toEqual([
      'auth login',
      'auth devices list',
      'auth devices revoke',
    ])
  })

  it('renders full-depth leaves at the top level (third-level commands visible)', async () => {
    const result = await captureRun(groupTree, [])
    expect(result.stdout).toContain('auth login')
    expect(result.stdout).toContain('auth devices list')
    expect(result.stdout).toContain('auth devices revoke')
  })
})
