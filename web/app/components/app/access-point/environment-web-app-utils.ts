import type { EnvironmentSite } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { AccessMode } from '@/models/access-control'
import { basePath } from '@/utils/var'

export const ENVIRONMENT_ACCESS_MODES = [
  AccessMode.ORGANIZATION,
  AccessMode.SPECIFIC_GROUPS_MEMBERS,
  AccessMode.PUBLIC,
] as const satisfies readonly AccessMode[]

export type EnvironmentAccessMode = (typeof ENVIRONMENT_ACCESS_MODES)[number]

export function normalizeEnvironmentAccessMode(accessMode?: string): EnvironmentAccessMode {
  if (accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS) return AccessMode.SPECIFIC_GROUPS_MEMBERS
  if (accessMode === AccessMode.PUBLIC) return AccessMode.PUBLIC
  return AccessMode.ORGANIZATION
}

export function getEnvironmentWebAppUrl(site?: EnvironmentSite) {
  if (!site?.app_base_url || !site.code) return ''

  return `${site.app_base_url.replace(/\/$/, '')}${basePath}/env/workflow/${site.code}`
}
