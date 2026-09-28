import type {
  AppDetailSiteResponse,
  AppDetailWithSite,
} from '@dify/contracts/api/console/apps/types.gen'

export function createAppSiteFixture(
  overrides: Partial<AppDetailSiteResponse> = {},
): AppDetailSiteResponse {
  return {
    access_token: 'site-token',
    app_base_url: 'https://apps.example.test',
    chat_color_theme: null,
    chat_color_theme_inverted: false,
    code: 'site-token',
    copyright: null,
    created_at: 1,
    created_by: null,
    custom_disclaimer: '',
    customize_domain: null,
    customize_token_strategy: 'not_allow',
    default_language: 'en-US',
    description: null,
    icon: null,
    icon_background: null,
    icon_type: null,
    icon_url: null,
    input_placeholder: null,
    privacy_policy: null,
    prompt_public: false,
    show_workflow_steps: false,
    title: 'App',
    updated_at: 1,
    updated_by: null,
    use_icon_as_answer_icon: false,
    ...overrides,
  }
}

export function createAppDetailFixture(
  overrides: Partial<AppDetailWithSite> = {},
): AppDetailWithSite {
  return {
    access_mode: null,
    api_base_url: 'https://api.example.test/v1',
    app_id: null,
    bound_agent_id: null,
    created_at: 1,
    created_by: null,
    deleted_tools: [],
    description: '',
    enable_api: true,
    enable_site: true,
    icon: null,
    icon_background: null,
    icon_type: null,
    icon_url: null,
    id: 'app-1',
    maintainer: null,
    max_active_requests: null,
    mode: 'chat',
    model_config: null,
    name: 'App',
    permission_keys: [],
    site: null,
    tags: [],
    tracing: null,
    updated_at: 1,
    updated_by: null,
    use_icon_as_answer_icon: false,
    workflow: null,
    ...overrides,
  }
}
