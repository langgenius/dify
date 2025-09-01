/**
 * This is a mock of the system features object for the login page
 * It is used to test the login page when all methods are disabled
 */
const AllMethodsDisabled = {
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
  enable_marketplace: true,
  max_plugin_package_size: 52428800,
  enable_email_code_login: false,
  enable_email_password_login: false,
  enable_social_oauth_login: false,
  is_allow_register: true,
  is_allow_create_workspace: true,
  is_email_setup: true,
  license: {
    status: 'none',
    expired_at: '',
    workspaces: {
      enabled: false,
      size: 0,
      limit: 0,
    },
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
    plugin_installation_scope: 'all',
    restrict_to_marketplace_only: false,
  },
  enable_change_email: true,
}

export default AllMethodsDisabled
