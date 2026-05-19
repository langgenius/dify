import pc from 'picocolors'

export type ColorScheme = {
  bold: (s: string) => string
  dim: (s: string) => string
  cyan: (s: string) => string
  green: (s: string) => string
  yellow: (s: string) => string
  magenta: (s: string) => string
  successIcon: () => string
  warningIcon: () => string
  failureIcon: () => string
}

const identity = (s: string): string => s

export function colorScheme(enabled: boolean): ColorScheme {
  if (!enabled) {
    return {
      bold: identity,
      dim: identity,
      cyan: identity,
      green: identity,
      yellow: identity,
      magenta: identity,
      successIcon: () => '✓',
      warningIcon: () => '!',
      failureIcon: () => '✗',
    }
  }
  return {
    bold: s => pc.bold(s),
    dim: s => pc.dim(s),
    cyan: s => pc.cyan(s),
    green: s => pc.green(s),
    yellow: s => pc.yellow(s),
    magenta: s => pc.magenta(s),
    successIcon: () => pc.green('✓'),
    warningIcon: () => pc.yellow('!'),
    failureIcon: () => pc.red('✗'),
  }
}

export function colorEnabled(isTTY: boolean): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '')
    return false
  if (process.env.DIFYCTL_NO_COLOR !== undefined && process.env.DIFYCTL_NO_COLOR !== '')
    return false
  return isTTY
}
