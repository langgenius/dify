import type {
  ApiProviderDetailResponse,
  ToolProviderApiEntityResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import {
  selectApiSchemaParameters,
  selectCustomCollection,
  selectMCPServerDetail,
  selectRAGRecommendedPlugins,
  selectToolsWithProvider,
  selectWorkflowToolDetail,
} from '../query-select'

const createProvider = (
  overrides: Partial<ToolProviderApiEntityResponse> = {},
): ToolProviderApiEntityResponse => ({
  id: 'provider-1',
  name: 'provider',
  author: 'dify',
  label: { en_US: 'Provider', zh_Hans: null },
  description: { en_US: 'Description', zh_Hans: '描述' },
  icon: '/icon.svg',
  type: 'builtin',
  ...overrides,
})

describe('tool query selectors', () => {
  it('should fill untranslated labels and defaulted provider flags', () => {
    const [provider] = selectToolsWithProvider([createProvider()])

    expect(provider).toMatchObject({
      label: { en_US: 'Provider', zh_Hans: 'Provider' },
      description: { en_US: 'Description', zh_Hans: '描述' },
      is_team_authorization: false,
      allow_delete: false,
      labels: [],
      team_credentials: {},
      tools: [],
    })
    expect(provider!.label).not.toHaveProperty('ja_JP')
  })

  it('should keep emoji icons and drop unknown identity modes', () => {
    const [provider] = selectToolsWithProvider([
      createProvider({
        icon: { background: '#fff', content: '🔧' },
        identity_mode: 'legacy',
        plugin_id: null,
      }),
    ])

    expect(provider!.icon).toEqual({ background: '#fff', content: '🔧' })
    expect(provider!.identity_mode).toBeUndefined()
    expect(provider!.plugin_id).toBeUndefined()
  })

  it('should map tool parameters and keep non-string defaults', () => {
    const [provider] = selectToolsWithProvider([
      createProvider({
        tools: [
          {
            name: 'search',
            author: 'dify',
            label: { en_US: 'Search' },
            description: { en_US: 'Search the web' },
            parameters: [
              {
                name: 'limit',
                label: { en_US: 'Limit' },
                form: 'form',
                type: 'number',
                default: 10,
                human_description: null,
                options: [{ label: { en_US: 'Ten' }, value: '10' }],
              },
            ],
          },
        ],
      }),
    ])

    const parameter = provider!.tools[0]!.parameters[0]!
    expect(parameter).toMatchObject({
      default: 10,
      required: false,
      multiple: false,
      llm_description: '',
      human_description: { en_US: '', zh_Hans: '' },
      options: [{ label: { en_US: 'Ten', zh_Hans: 'Ten' }, value: '10' }],
    })
  })

  it('should keep only string MCP server parameters', () => {
    expect(
      selectMCPServerDetail({
        id: 'server-1',
        name: 'server',
        server_code: 'code',
        description: '',
        status: 'active',
        parameters: { query: 'Question', count: 3 },
      }).parameters,
    ).toEqual({ query: 'Question' })
    expect(
      selectMCPServerDetail({
        id: 'server-1',
        name: 'server',
        server_code: 'code',
        description: '',
        status: 'active',
        parameters: [],
      }).parameters,
    ).toBeUndefined()
  })

  it('should narrow the workflow tool output schema', () => {
    const detail = selectWorkflowToolDetail({
      name: 'tool',
      label: 'Tool',
      description: '',
      icon: { background: '#fff', content: '🔧' },
      parameters: [],
      synced: true,
      workflow_app_id: 'app-1',
      workflow_tool_id: 'tool-1',
      tool: {
        name: 'tool',
        author: 'dify',
        label: { en_US: 'Tool' },
        description: { en_US: '' },
        output_schema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text' }, broken: 'x' },
        },
      },
    })

    expect(detail.privacy_policy).toBe('')
    expect(detail.tool.output_schema).toEqual({
      type: 'object',
      properties: { text: { type: 'string', description: 'Text' } },
    })
  })

  it('should keep installable marketplace recommendations', () => {
    const plugin = {
      type: 'plugin',
      org: 'langgenius',
      name: 'notion',
      plugin_id: 'langgenius/notion',
      latest_package_identifier: 'langgenius/notion:1.0.0@hash',
    }
    const recommendations = selectRAGRecommendedPlugins({
      installed_recommended_plugins: [createProvider()],
      uninstalled_recommended_plugins: [plugin, { plugin_id: 'broken' }],
    })

    expect(recommendations.installed_recommended_plugins[0]!.tools).toEqual([])
    expect(recommendations.uninstalled_recommended_plugins).toEqual([plugin])
  })

  it('should label parsed operations without an id or summary as empty', () => {
    expect(
      selectApiSchemaParameters({
        schema_type: 'openapi',
        credentials_schema: [],
        warning: {},
        parameters_schema: [
          { author: 'dify', method: 'get', openapi: {}, server_url: 'https://api.example.com' },
        ],
      }).parameters_schema,
    ).toEqual([
      {
        operation_id: '',
        summary: '',
        server_url: 'https://api.example.com',
        method: 'get',
        parameters: [],
      },
    ])
  })

  it('should read stored API provider credentials by their auth type', () => {
    const detail: ApiProviderDetailResponse = {
      schema_type: 'openapi',
      schema: '{}',
      tools: [],
      icon: { background: '#FFF', content: '🔧' },
    }

    expect(
      selectCustomCollection({
        ...detail,
        credentials: {
          auth_type: 'api_key_header',
          api_key_header: 'Authorization',
          api_key_header_prefix: 'bearer',
          api_key_value: '[__HIDDEN__]',
        },
      }).credentials,
    ).toEqual({
      auth_type: 'api_key_header',
      api_key_header: 'Authorization',
      api_key_header_prefix: 'bearer',
      api_key_value: '[__HIDDEN__]',
      api_key_query_param: undefined,
    })
    expect(selectCustomCollection(detail)).toMatchObject({
      credentials: { auth_type: 'none' },
      privacy_policy: '',
      custom_disclaimer: '',
    })
  })
})
