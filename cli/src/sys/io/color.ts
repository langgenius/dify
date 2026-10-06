import { createColors } from 'picocolors'

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

export type Style = ColorScheme

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
  // createColors(true) forces ANSI output regardless of TTY/env so this module
  // never reads the environment itself; callers decide enablement via colorEnabled.
  const pc = createColors(true)
  return {
    bold: (s) => pc.bold(s),
    dim: (s) => pc.dim(s),
    cyan: (s) => pc.cyan(s),
    green: (s) => pc.green(s),
    yellow: (s) => pc.yellow(s),
    magenta: (s) => pc.magenta(s),
    successIcon: () => pc.green('✓'),
    warningIcon: () => pc.yellow('!'),
    failureIcon: () => pc.red('✗'),
  }
}

export const NO_COLOR_ENV = 'NO_COLOR'

export function colorEnabled(isTTY: boolean, env: NodeJS.ProcessEnv): boolean {
  return isTTY && env[NO_COLOR_ENV] === undefined
}
