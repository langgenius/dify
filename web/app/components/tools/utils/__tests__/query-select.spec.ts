import type { ToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import {
  selectMCPServerDetail,
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
})
