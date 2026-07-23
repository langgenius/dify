import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { InstallationScope, LicenseStatus } from '@/features/system-features/constants'

export type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<U>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

const baseSystemFeatures = {
  deployment_edition: 'COMMUNITY',
  enable_app_deploy: false,
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
  enable_marketplace: false,
  enable_email_code_login: false,
  enable_email_password_login: true,
  enable_social_oauth_login: false,
  enable_collaboration_mode: true,
  is_allow_create_workspace: false,
  is_allow_register: false,
  is_email_setup: false,
  enable_change_email: true,
  max_plugin_package_size: 15728640,
  license: {
    status: LicenseStatus.NONE,
    expired_at: '',
    workspaces: {
      enabled: false,
      size: 0,
      limit: 0,
    },
    seats: {
      enabled: false,
      size: 0,
      limit: 0,
    },
  },
  branding: {
    enabled: false,
    login_page_logo: '',
    workspace_logo: '',
    favicon: '',
    application_title: '',
  },
  webapp_auth: {
    enabled: false,
    allow_sso: false,
    sso_config: {
      protocol: '',
    },
    allow_email_code_login: false,
    allow_email_password_login: false,
    allow_public_access: true,
  },
  plugin_installation_permission: {
    plugin_installation_scope: InstallationScope.ALL,
    restrict_to_marketplace_only: false,
  },
  plugin_manager: {
    enabled: false,
  },
  rbac_enabled: false,
  enable_creators_platform: false,
  enable_trial_app: false,
  enable_explore_banner: false,
  enable_learn_app: true,
  enable_step_by_step_tour: false,
  knowledge_fs_enabled: false,
} satisfies GetSystemFeaturesResponse

export const createSystemFeaturesFixture = (
  overrides: DeepPartial<GetSystemFeaturesResponse> = {},
): GetSystemFeaturesResponse => ({
  ...baseSystemFeatures,
  ...overrides,
  branding: {
    ...baseSystemFeatures.branding,
    ...overrides.branding,
  },
  webapp_auth: {
    ...baseSystemFeatures.webapp_auth,
    ...overrides.webapp_auth,
    sso_config: {
      ...baseSystemFeatures.webapp_auth.sso_config,
      ...overrides.webapp_auth?.sso_config,
    },
  },
  plugin_installation_permission: {
    ...baseSystemFeatures.plugin_installation_permission,
    ...overrides.plugin_installation_permission,
  },
  license: {
    ...baseSystemFeatures.license,
    ...overrides.license,
    workspaces: {
      ...baseSystemFeatures.license.workspaces,
      ...overrides.license?.workspaces,
    },
    seats: {
      ...baseSystemFeatures.license.seats,
      ...overrides.license?.seats,
    },
  },
  plugin_manager: {
    ...baseSystemFeatures.plugin_manager,
    ...overrides.plugin_manager,
  },
})
