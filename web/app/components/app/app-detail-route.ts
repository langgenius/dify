export function getAppIdFromPathname(pathname: string) {
  const [, section, appId] = pathname.split('/')
  return section === 'app' && appId ? appId : undefined
}
