import { describe, expect, it } from 'vitest'
import { UnsupportedArgValueError } from './errors'
import { Args, Flags, parseArgv } from './flags'

const meta = {
  flags: {
    output: Flags.string({ description: 'output format', char: 'o' }),
    verbose: Flags.boolean({ description: 'verbose mode', char: 'v' }),
    count: Flags.integer({ description: 'count', default: 5 }),
    format: Flags.string({ description: 'format', default: 'text' }),
  },
  args: {
    name: Args.string({ description: 'name', required: true }),
    extra: Args.string({ description: 'extra' }),
  },
}

describe('parseArgv', () => {
  describe('positional args', () => {
    it('parses required arg', () => {
      const { args } = parseArgv(['alice'], meta)
      expect(args.name).toBe('alice')
    })

    it('parses optional arg when provided', () => {
      const { args } = parseArgv(['alice', 'bonus'], meta)
      expect(args.name).toBe('alice')
      expect(args.extra).toBe('bonus')
    })

    it('leaves optional arg undefined when absent', () => {
      const { args } = parseArgv(['alice'], meta)
      expect(args.extra).toBeUndefined()
    })

    it('throws on missing required arg', () => {
      expect(() => parseArgv([], meta)).toThrow('missing required argument: name')
    })
  })

  describe('long flags (--flag value)', () => {
    it('parses string flag with space separator', () => {
      const { flags } = parseArgv(['alice', '--output', 'json'], meta)
      expect(flags.output).toBe('json')
    })

    it('parses string flag with = separator', () => {
      const { flags } = parseArgv(['alice', '--output=yaml'], meta)
      expect(flags.output).toBe('yaml')
    })

    it('parses boolean flag as true when bare', () => {
      const { flags } = parseArgv(['alice', '--verbose'], meta)
      expect(flags.verbose).toBe(true)
    })

    it('parses boolean flag with =true', () => {
      const { flags } = parseArgv(['alice', '--verbose=true'], meta)
      expect(flags.verbose).toBe(true)
    })

    it('parses boolean flag with =false', () => {
      const { flags } = parseArgv(['alice', '--verbose=false'], meta)
      expect(flags.verbose).toBe(false)
    })

    it('parses integer flag', () => {
      const { flags } = parseArgv(['alice', '--count', '10'], meta)
      expect(flags.count).toBe(10)
    })

    it('parses integer flag with = separator', () => {
      const { flags } = parseArgv(['alice', '--count=42'], meta)
      expect(flags.count).toBe(42)
    })

    it('throws on non-integer value for integer flag', () => {
      expect(() => parseArgv(['alice', '--count', 'abc'], meta)).toThrow(
        'expected integer, got "abc"',
      )
    })

    it('throws on invalid boolean value', () => {
      expect(() => parseArgv(['alice', '--verbose=maybe'], meta)).toThrow(
        'expected boolean, got "maybe"',
      )
    })

    it('throws when non-boolean flag has no value', () => {
      expect(() => parseArgv(['alice', '--output'], meta)).toThrow('flag --output expects a value')
    })

    it('throws on unknown long flag', () => {
      expect(() => parseArgv(['alice', '--unknown', 'x'], meta)).toThrow('unknown flag: --unknown')
    })
  })

  describe('short flags (-x)', () => {
    it('parses short boolean flag', () => {
      const { flags } = parseArgv(['alice', '-v'], meta)
      expect(flags.verbose).toBe(true)
    })

    it('parses short string flag with space-separated value', () => {
      const { flags } = parseArgv(['alice', '-o', 'json'], meta)
      expect(flags.output).toBe('json')
    })

    it('throws when short non-boolean flag has no value', () => {
      expect(() => parseArgv(['alice', '-o'], meta)).toThrow('flag -o expects a value')
    })

    it('throws on unknown short flag', () => {
      expect(() => parseArgv(['alice', '-z'], meta)).toThrow('unknown flag: -z')
    })
  })

  describe('multiple: true', () => {
    const multipleMeta = {
      flags: {
        label: Flags.stringArray({ description: 'labels' }),
        output: Flags.string({ description: 'output', char: 'o' }),
      },
      args: {},
    }

    it('collects repeated long flags into an array', () => {
      const { flags } = parseArgv(['--label', 'foo', '--label', 'bar'], multipleMeta)
      expect(flags.label).toEqual(['foo', 'bar'])
    })

    it('collects repeated long flags with = separator', () => {
      const { flags } = parseArgv(['--label=foo', '--label=bar', '--label=baz'], multipleMeta)
      expect(flags.label).toEqual(['foo', 'bar', 'baz'])
    })

    it('collects repeated short flags into an array', () => {
      const multipleShortMeta = {
        flags: { label: Flags.string({ description: 'labels', multiple: true, char: 'l' }) },
        args: {},
      }
      const { flags } = parseArgv(['-l', 'foo', '-l', 'bar'], multipleShortMeta)
      expect(flags.label).toEqual(['foo', 'bar'])
    })

    it('single occurrence still produces array with one element', () => {
      const { flags } = parseArgv(['--label', 'only'], multipleMeta)
      expect(flags.label).toEqual(['only'])
    })

    it('absent multiple flag is undefined', () => {
      const { flags } = parseArgv([], multipleMeta)
      expect(flags.label).toBeUndefined()
    })

    it('non-multiple flag is not affected', () => {
      const { flags } = parseArgv(['--output', 'json'], multipleMeta)
      expect(flags.output).toBe('json')
    })
  })

  describe('double-dash (--) separator', () => {
    it('treats tokens after -- as positional args', () => {
      const { args, flags } = parseArgv(['alice', '--', '--output', 'json'], meta)
      expect(flags.output).toBeUndefined()
      expect(args.extra).toBe('--output')
    })
  })

  describe('defaults', () => {
    it('applies flag default when flag is absent', () => {
      const { flags } = parseArgv(['alice'], meta)
      expect(flags.count).toBe(5)
      expect(flags.format).toBe('text')
    })

    it('does not apply default when flag is provided', () => {
      const { flags } = parseArgv(['alice', '--count', '99'], meta)
      expect(flags.count).toBe(99)
    })
  })

  describe('options validation', () => {
    const metaWithOptions = {
      flags: {
        mode: Flags.string({
          description: 'app mode',
          options: ['chat', 'workflow', 'completion'],
        }),
      },
      args: {},
    }

    it('accepts a valid option value', () => {
      const { flags } = parseArgv(['--mode', 'chat'], metaWithOptions)
      expect(flags.mode).toBe('chat')
    })

    it('rejects an invalid option value (space form)', () => {
      expect(() => parseArgv(['--mode', 'chatbot'], metaWithOptions)).toThrow(
        UnsupportedArgValueError,
      )
    })

    it('rejects an invalid option value (= form)', () => {
      expect(() => parseArgv(['--mode=chatbot'], metaWithOptions)).toThrow(UnsupportedArgValueError)
    })
  })

  describe('Flags and Args factory', () => {
    it('Flags.string produces string type definition', () => {
      const def = Flags.string({ description: 'test' })
      expect(def.type).toBe('string')
    })

    it('Flags.boolean produces boolean type definition', () => {
      const def = Flags.boolean({ description: 'test' })
      expect(def.type).toBe('boolean')
    })

    it('Flags.integer produces integer type definition', () => {
      const def = Flags.integer({ description: 'test' })
      expect(def.type).toBe('integer')
    })

    it('Args.string produces an arg definition with required when set', () => {
      const def = Args.string({ description: 'test', required: true })
      expect(def.required).toBe(true)
    })
  })
})
