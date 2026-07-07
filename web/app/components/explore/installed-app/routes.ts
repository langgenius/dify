export const buildInstalledAppPath = (appId: string) => {
  return `/installed/${appId}`
}

export const buildLegacyInstalledAppPath = (appId: string) => {
  return `/explore/installed/${appId}`
}

export const isInstalledAppPath = (pathname: string, appId?: string) => {
  const normalizedPathname = (pathname.split(/[?#]/)[0] || '/').replace(/\/$/, '')
  const installedPath = appId ? buildInstalledAppPath(appId) : '/installed'
  const legacyInstalledPath = appId ? buildLegacyInstalledAppPath(appId) : '/explore/installed'

  return normalizedPathname === installedPath
    || normalizedPathname.startsWith(`${installedPath}/`)
    || normalizedPathname === legacyInstalledPath
    || normalizedPathname.startsWith(`${legacyInstalledPath}/`)
}
