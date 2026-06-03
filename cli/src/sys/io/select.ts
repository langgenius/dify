import type { Key } from 'node:readline'
import type { IOStreams } from './streams'
import * as readline from 'node:readline'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { colorEnabled, colorScheme } from './color'

export type SelectOptions<T> = {
  readonly io: IOStreams
  readonly items: readonly T[]
  readonly header: string
  /** Single rich line shown per option. */
  readonly render: (item: T) => string
  /** Optional second line shown only for the focused option in the TTY picker. */
  readonly describe?: (item: T) => string
}

const HIDE_CURSOR = '\x1B[?25l'
const SHOW_CURSOR = '\x1B[?25h'
const CLEAR_DOWN = '\x1B[0J'
const cursorUp = (n: number): string => `\x1B[${n}A`

export async function selectFromList<T>(opts: SelectOptions<T>): Promise<T> {
  if (opts.items.length === 0)
    throw new BaseError({ code: ErrorCode.UsageMissingArg, message: 'nothing to select' })
  return opts.io.isErrTTY ? pickInteractive(opts) : pickNumbered(opts)
}

/**
 * Arrow-key picker built on Node's readline keypress events — no third-party
 * prompt library, so it bundles cleanly into the compiled binary. Renders to
 * the err stream, redrawing in place on each keystroke and erasing itself on
 * exit so the caller's own output starts on a clean row.
 */
async function pickInteractive<T>(opts: SelectOptions<T>): Promise<T> {
  const input = opts.io.in as NodeJS.ReadStream
  const out = opts.io.err
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const count = opts.items.length

  return new Promise<T>((resolve, reject) => {
    let active = 0
    let rendered = 0

    const frame = (): readonly string[] => {
      const lines = [opts.header]
      opts.items.forEach((item, i) => {
        const focused = i === active
        const pointer = focused ? cs.cyan('❯') : ' '
        const label = focused ? cs.bold(opts.render(item)) : opts.render(item)
        lines.push(`${pointer} ${label}`)
      })
      const desc = opts.describe?.(opts.items[active] as T)
      if (desc !== undefined && desc !== '')
        lines.push(cs.dim(`  ${desc}`))
      return lines
    }

    const render = (): void => {
      if (rendered > 0)
        out.write(cursorUp(rendered))
      const lines = frame()
      out.write(`${CLEAR_DOWN}${lines.join('\n')}\n`)
      rendered = lines.length
    }

    const wasRaw = input.isTTY ? input.isRaw : false
    const cleanup = (): void => {
      input.off('keypress', onKey)
      if (input.isTTY)
        input.setRawMode(wasRaw)
      input.pause()
      if (rendered > 0)
        out.write(`${cursorUp(rendered)}${CLEAR_DOWN}`)
      out.write(SHOW_CURSOR)
    }

    function onKey(_str: string | undefined, key: Key): void {
      if (key.ctrl && key.name === 'c') {
        cleanup()
        reject(cancelled())
        return
      }
      switch (key.name) {
        case 'up':
        case 'k':
          active = (active - 1 + count) % count
          render()
          break
        case 'down':
        case 'j':
          active = (active + 1) % count
          render()
          break
        case 'return':
        case 'enter': {
          const chosen = opts.items[active]
          cleanup()
          if (chosen === undefined)
            reject(new BaseError({ code: ErrorCode.UsageInvalidFlag, message: 'invalid selection' }))
          else
            resolve(chosen)
          break
        }
        case 'escape':
          cleanup()
          reject(cancelled())
          break
        default:
          break
      }
    }

    try {
      readline.emitKeypressEvents(input)
      if (input.isTTY)
        input.setRawMode(true)
      out.write(HIDE_CURSOR)
      input.on('keypress', onKey)
      input.resume()
      render()
    }
    catch (err) {
      cleanup()
      reject(err)
    }
  })
}

function cancelled(): BaseError {
  return new BaseError({ code: ErrorCode.UsageMissingArg, message: 'selection cancelled' })
}

async function pickNumbered<T>(opts: SelectOptions<T>): Promise<T> {
  opts.io.err.write(`${opts.header}\n`)
  opts.items.forEach((item, idx) => {
    opts.io.err.write(`  ${idx + 1}) ${opts.render(item)}\n`)
  })
  opts.io.err.write('Enter number: ')

  const rl = readline.createInterface({ input: opts.io.in, output: opts.io.err, terminal: false })
  try {
    const line: string = await new Promise(resolve => rl.once('line', resolve))
    const n = Number(line.trim())
    const chosen = Number.isInteger(n) ? opts.items[n - 1] : undefined
    if (chosen === undefined)
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: `invalid selection: ${line.trim()}` })
    return chosen
  }
  finally {
    rl.close()
  }
}
