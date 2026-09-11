import type { EnvironmentSite } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

export function getEnvironmentWebAppUrl(site?: EnvironmentSite, mode?: string) {
  if (!site?.app_base_url || !site.code) return ''

  const route = mode === AppModeEnum.ADVANCED_CHAT ? 'chat' : 'workflow'
  return `${site.app_base_url.replace(/\/$/, '')}${basePath}/environment/${route}/${site.code}`
}
