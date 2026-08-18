import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'

export function getAppSiteURL({ mode, site }: AppDetailWithSite): string {
  if (!site?.app_base_url || !site.access_token)
    throw new Error('App detail does not include a Web App URL.')

  const webAppMode = (() => {
    if (mode === 'completion' || mode === 'workflow') return mode
    if (mode === 'advanced-chat' || mode === 'agent-chat' || mode === 'chat') return 'chat'
    throw new Error(`Unsupported Web App mode: ${mode}`)
  })()

  return `${site.app_base_url}/${webAppMode}/${site.access_token}`
}
