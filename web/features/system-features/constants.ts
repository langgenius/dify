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

export const InstallationScope = {
  ALL: 'all',
  NONE: 'none',
  OFFICIAL_ONLY: 'official_only',
  OFFICIAL_AND_PARTNER: 'official_and_specific_partners',
} as const satisfies Record<
  string,
  GetSystemFeaturesResponse['plugin_installation_permission']['plugin_installation_scope']
>
