import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'

export const SSOProtocol = {
  SAML: 'saml',
  OIDC: 'oidc',
  OAuth2: 'oauth2',
} as const

export const LicenseStatus = {
  NONE: 'none',
  INACTIVE: 'inactive',
  ACTIVE: 'active',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
  LOST: 'lost',
} as const satisfies Record<string, GetSystemFeaturesResponse['license']['status']>

// A license in any other state (including a lapsed enterprise one) is treated as
// non-enterprise, so enterprise-only suppressions fail toward showing content.
export const ENTERPRISE_LICENSE_STATUSES: ReadonlySet<
  GetSystemFeaturesResponse['license']['status']
> = new Set([LicenseStatus.ACTIVE, LicenseStatus.EXPIRING])

export const InstallationScope = {
  ALL: 'all',
  NONE: 'none',
  OFFICIAL_ONLY: 'official_only',
  OFFICIAL_AND_PARTNER: 'official_and_specific_partners',
} as const satisfies Record<
  string,
  GetSystemFeaturesResponse['plugin_installation_permission']['plugin_installation_scope']
>
