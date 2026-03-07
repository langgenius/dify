import * as z from 'zod'
import { ModelProviderQuotaGetPaid } from './model-provider'

export enum SSOProtocol {
  SAML = 'saml',
  OIDC = 'oidc',
  OAuth2 = 'oauth2',
}

export enum LicenseStatus {
  NONE = 'none',
  INACTIVE = 'inactive',
  ACTIVE = 'active',
  EXPIRING = 'expiring',
  EXPIRED = 'expired',
  LOST = 'lost',
}

export enum InstallationScope {
  ALL = 'all',
  NONE = 'none',
  OFFICIAL_ONLY = 'official_only',
  OFFICIAL_AND_PARTNER = 'official_and_specific_partners',
}

const ssoProtocolOrEmptySchema = z.nativeEnum(SSOProtocol).or(z.literal(''))

// Zod schema is the single source of truth for SystemFeatures.
// The TypeScript type is derived from it via z.infer<> so they can never diverge.
// Uses .passthrough() on nested objects to allow forward-compatible API additions.
export const systemFeaturesSchema = z
  .object({
    trial_models: z.array(z.nativeEnum(ModelProviderQuotaGetPaid)),
    plugin_installation_permission: z
      .object({
        plugin_installation_scope: z.nativeEnum(InstallationScope),
        restrict_to_marketplace_only: z.boolean(),
      })
      .passthrough(),
    sso_enforced_for_signin: z.boolean(),
    sso_enforced_for_signin_protocol: ssoProtocolOrEmptySchema,
    sso_enforced_for_web: z.boolean(),
    sso_enforced_for_web_protocol: ssoProtocolOrEmptySchema,
    enable_marketplace: z.boolean(),
    enable_change_email: z.boolean(),
    enable_email_code_login: z.boolean(),
    enable_email_password_login: z.boolean(),
    enable_social_oauth_login: z.boolean(),
    is_allow_create_workspace: z.boolean(),
    is_allow_register: z.boolean(),
    is_email_setup: z.boolean(),
    license: z
      .object({ status: z.nativeEnum(LicenseStatus), expired_at: z.string().nullable() })
      .passthrough(),
    branding: z
      .object({
        enabled: z.boolean(),
        login_page_logo: z.string(),
        workspace_logo: z.string(),
        favicon: z.string(),
        application_title: z.string(),
      })
      .passthrough(),
    webapp_auth: z
      .object({
        enabled: z.boolean(),
        allow_sso: z.boolean(),
        sso_config: z.object({ protocol: ssoProtocolOrEmptySchema }).passthrough(),
        allow_email_code_login: z.boolean(),
        allow_email_password_login: z.boolean(),
      })
      .passthrough(),
    enable_trial_app: z.boolean(),
    enable_explore_banner: z.boolean(),
  })
  .passthrough()

export type SystemFeatures = z.infer<typeof systemFeaturesSchema>

export const defaultSystemFeatures: SystemFeatures = {
  trial_models: [],
  plugin_installation_permission: {
    plugin_installation_scope: InstallationScope.ALL,
    restrict_to_marketplace_only: false,
  },
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
  sso_enforced_for_web: false,
  sso_enforced_for_web_protocol: '',
  enable_marketplace: false,
  enable_change_email: false,
  enable_email_code_login: false,
  enable_email_password_login: false,
  enable_social_oauth_login: false,
  is_allow_create_workspace: false,
  is_allow_register: false,
  is_email_setup: false,
  license: {
    status: LicenseStatus.NONE,
    expired_at: '',
  },
  branding: {
    enabled: false,
    login_page_logo: '',
    workspace_logo: '',
    favicon: '',
    application_title: 'test title',
  },
  webapp_auth: {
    enabled: false,
    allow_sso: false,
    sso_config: {
      protocol: '',
    },
    allow_email_code_login: false,
    allow_email_password_login: false,
  },
  enable_trial_app: false,
  enable_explore_banner: false,
}
