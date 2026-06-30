import type { IOStreams } from './streams'
import oraImport from 'ora'

const DIFY_FRAMES = ['Dify', 'dIfy', 'diFy', 'difY', 'diFy', 'dIfy']
const DIFY_BLUE_RGB = '\x1B[38;2;0;51;255m'
const DIFY_BLUE_256 = '\x1B[38;5;27m'
const DIM = '\x1B[2m'
const ANSI_RESET = '\x1B[0m'

export type SpinnerStyle = 'dify' | 'dify-dim'

function colorize(s: string, style: SpinnerStyle, truecolor: boolean): string {
  if (style === 'dify-dim')
    return `${DIM}${s}${ANSI_RESET}`
  return `${truecolor ? DIFY_BLUE_RGB : DIFY_BLUE_256}${s}${ANSI_RESET}`
}

function detectTruecolor(env: NodeJS.ProcessEnv): boolean {
  const v = env.COLORTERM ?? ''
  return v === 'truecolor' || v === '24bit'
}

const STRUCTURED_FORMATS = new Set(['json', 'yaml', 'name'])

export type SpinnerOptions = {
  readonly io: IOStreams
  readonly label: string
  readonly enabled?: boolean
  readonly style?: SpinnerStyle
  readonly minDisplayMs?: number
  readonly env?: NodeJS.ProcessEnv
}

const DEFAULT_MIN_DISPLAY_MS = 600

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export type ActiveSpinner = { stop: () => void }

const NOOP_SPINNER: ActiveSpinner = { stop: () => {} }

function buildOraSpinner(opts: SpinnerOptions) {
  const env = opts.env ?? process.env
  const truecolor = detectTruecolor(env)
  const style = opts.style ?? 'dify'
  const frames = DIFY_FRAMES.map(f => colorize(f, style, truecolor))
  return oraImport({
    text: opts.label,
    stream: opts.io.err as NodeJS.WriteStream,
    spinner: { frames, interval: 140 },
    discardStdin: false,
  })
}

function isActive(opts: SpinnerOptions): boolean {
  const spinnerEnabled = opts.enabled ?? !STRUCTURED_FORMATS.has(opts.io.outputFormat)
  return spinnerEnabled && opts.io.isErrTTY
}

export function startSpinner(opts: SpinnerOptions): ActiveSpinner {
  if (!isActive(opts))
    return NOOP_SPINNER
  const ora = buildOraSpinner(opts).start()
  let stopped = false
  return {
    stop: () => {
      if (!stopped) {
        stopped = true
        ora.stop()
      }
    },
  }
}

export async function runWithSpinner<T>(
  opts: SpinnerOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isActive(opts))
    return fn()

  const minMs = opts.minDisplayMs ?? DEFAULT_MIN_DISPLAY_MS
  const start = Date.now()
  const spinner = buildOraSpinner(opts).start()

  const enforceMin = async () => {
    const remaining = minMs - (Date.now() - start)
    if (remaining > 0)
      await sleep(remaining)
  }

  try {
    const result = await fn()
    await enforceMin()
    spinner.succeed(opts.label)
    return result
  }
  catch (err) {
    await enforceMin()
    spinner.fail(opts.label)
    throw err
  }
}
