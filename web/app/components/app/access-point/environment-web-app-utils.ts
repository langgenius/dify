import type { EnvironmentSite } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { basePath } from '@/utils/var'

export function getEnvironmentWebAppUrl(environmentId: string, site?: EnvironmentSite) {
  if (!site?.app_base_url || !site.code) return ''

  return `${site.app_base_url.replace(/\/$/, '')}${basePath}/workflow/environments/${environmentId}/${site.code}`
}
