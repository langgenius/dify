import { arch, platform } from '@/sys/index'
import { compatString } from './compat'

export type Channel = 'dev' | 'alpha' | 'edge' | 'rc' | 'stable'

export type VersionInfo = {
  version: string
  commit: string
  buildDate: string
  channel: Channel
}

export const versionInfo: VersionInfo = {
  version: __DIFYCTL_VERSION__,
  commit: __DIFYCTL_COMMIT__,
  buildDate: __DIFYCTL_BUILD_DATE__,
  channel: __DIFYCTL_CHANNEL__ as Channel,
}

export function shortVersion(): string {
  return versionInfo.version
}

export function longVersion(): string {
  const { version, commit, buildDate, channel } = versionInfo
  return `difyctl ${version} (commit ${commit.slice(0, 7)}, built ${buildDate}, channel ${channel})\n`
    + `compat: ${compatString()}`
}

export function userAgent(): string {
  return `difyctl/${versionInfo.version} (${platform()}; ${arch()}; ${versionInfo.channel})`
}
