import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { env } from '@/env'
import { InstallationScope, LicenseStatus } from './constants'

export const defaultSystemFeatures = {
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
} satisfies GetSystemFeaturesResponse

export const cloudSystemFeatures = {
  ...defaultSystemFeatures,
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',

  enable_marketplace: env.NEXT_PUBLIC_ENABLE_MARKETPLACE,
  enable_email_code_login: env.NEXT_PUBLIC_ENABLE_EMAIL_CODE_LOGIN,
  enable_email_password_login: env.NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD_LOGIN,
  enable_social_oauth_login: env.NEXT_PUBLIC_ENABLE_SOCIAL_OAUTH_LOGIN,
  enable_collaboration_mode: env.NEXT_PUBLIC_ENABLE_COLLABORATION_MODE,
  is_allow_register: env.NEXT_PUBLIC_ALLOW_REGISTER,
  is_allow_create_workspace: env.NEXT_PUBLIC_ALLOW_CREATE_WORKSPACE,
  is_email_setup: env.NEXT_PUBLIC_IS_EMAIL_SETUP,
  enable_change_email: env.NEXT_PUBLIC_ENABLE_CHANGE_EMAIL,

  license: {
    ...defaultSystemFeatures.license,
    status: LicenseStatus.NONE,
    expired_at: '',
  },

  branding: {
    enabled: false,
    application_title: '',
    login_page_logo: '',
    workspace_logo: '',
    favicon: '',
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

  plugin_installation_permission: {
    plugin_installation_scope: InstallationScope.ALL,
    restrict_to_marketplace_only: false,
  },

  enable_creators_platform: env.NEXT_PUBLIC_CREATORS_PLATFORM_FEATURES_ENABLED,
  enable_trial_app: env.NEXT_PUBLIC_ENABLE_TRIAL_APP,
  enable_explore_banner: env.NEXT_PUBLIC_ENABLE_EXPLORE_BANNER,
  enable_learn_app: env.NEXT_PUBLIC_ENABLE_LEARN_APP,
} satisfies GetSystemFeaturesResponse
