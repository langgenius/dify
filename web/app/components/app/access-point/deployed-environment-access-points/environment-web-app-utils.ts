import type { EnvironmentSite } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { basePath } from '@/utils/var'

export function getEnvironmentWebAppUrl(site?: EnvironmentSite) {
  if (!site?.app_base_url || !site.code) return ''

  return `${site.app_base_url.replace(/\/$/, '')}${basePath}/env/workflow/${site.code}`
}
