import type { IOStreams } from './streams'
import * as readline from 'node:readline'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from './color'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type PromptTextOptions<T> = {
  readonly io: IOStreams
  readonly label: string
  readonly hint?: string
  readonly default?: string
  readonly acceptAsDefault?: (raw: string) => boolean
  readonly parse: (raw: string) => ParseResult<T>
}

function buildPromptLine(
  opts: Pick<PromptTextOptions<unknown>, 'label' | 'hint' | 'default'>,
): string {
  let line = opts.label
  if (opts.hint !== undefined) line += ` (${opts.hint})`
  if (opts.default !== undefined) line += ` [default: ${opts.default}]`
  return `${line}: `
}

function normalize(
  raw: string,
  opts: Pick<PromptTextOptions<unknown>, 'default' | 'acceptAsDefault'>,
): string {
  const trimmed = raw.trim()
  if (trimmed === '' || opts.acceptAsDefault?.(trimmed)) return opts.default ?? ''
  return trimmed
}

export async function promptConfirm(io: IOStreams, message: string): Promise<boolean> {
  io.err.write(message)
  const rl = readline.createInterface({ input: io.in, output: io.err, terminal: false })
  try {
    const line = await new Promise<string>((resolve) => rl.once('line', resolve))
    return line.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

export async function promptText<T>(opts: PromptTextOptions<T>): Promise<T> {
  const prompt = buildPromptLine(opts)
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    const rl = readline.createInterface({ input: opts.io.in, output: opts.io.err, terminal: false })

    rl.on('close', () => {
      settle(() =>
        reject(
          new BaseError({
            code: ErrorCode.UsageMissingArg,
            message: 'input closed before a valid value was provided',
          }),
        ),
      )
    })

    const onLine = (raw: string): void => {
      const value = normalize(raw, opts)

      if (!opts.io.isErrTTY) {
        const result = opts.parse(value)
        rl.off('line', onLine)
        settle(() => {
          rl.close()
          if (result.ok) resolve(result.value)
          else reject(new BaseError({ code: ErrorCode.UsageInvalidFlag, message: result.error }))
        })
        return
      }

      const result = opts.parse(value)
      if (result.ok) {
        rl.off('line', onLine)
        settle(() => {
          rl.close()
          resolve(result.value)
        })
      } else {
        opts.io.err.write(`  ${cs.failureIcon()} ${result.error}\n`)
        opts.io.err.write(prompt)
      }
    }

    opts.io.err.write(prompt)
    rl.on('line', onLine)
  })
}
