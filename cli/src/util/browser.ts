import openModule from 'open'

export const OpenDecision = {
  Auto: 'auto-open',
  SkipSSH: 'Detected SSH session',
  SkipHeadlessLinux: 'Headless Linux (no DISPLAY / WAYLAND_DISPLAY)',
  SkipNoTTY: 'Non-interactive TTY',
  SkipUserOptOut: '--no-browser requested',
} as const
export type OpenDecision = typeof OpenDecision[keyof typeof OpenDecision]

export type BrowserEnv = {
  getEnv: (key: string) => string | undefined
  platform: NodeJS.Platform
  isOutTTY: boolean
  isErrTTY: boolean
}

export function realEnv(): BrowserEnv {
  return {
    getEnv: k => process.env[k],
    platform: process.platform,
    isOutTTY: Boolean(process.stdout.isTTY),
    isErrTTY: Boolean(process.stderr.isTTY),
  }
}

export function decideOpen(env: BrowserEnv, userOptOut: boolean): OpenDecision {
  if (userOptOut)
    return OpenDecision.SkipUserOptOut
  if (truthy(env.getEnv('SSH_CONNECTION')) || truthy(env.getEnv('SSH_TTY')))
    return OpenDecision.SkipSSH
  if (env.platform === 'linux'
    && !truthy(env.getEnv('DISPLAY'))
    && !truthy(env.getEnv('WAYLAND_DISPLAY'))) {
    return OpenDecision.SkipHeadlessLinux
  }
  if (!env.isOutTTY || !env.isErrTTY)
    return OpenDecision.SkipNoTTY
  return OpenDecision.Auto
}

export type BrowserOpener = (url: string) => Promise<void>

export const openUrl: BrowserOpener = async (url) => {
  await openModule(url)
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && v !== ''
}
