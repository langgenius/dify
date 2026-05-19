import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { DSLImportStatus } from '@/models/app'
import { createApp, exportAppConfig, importDSL, importDSLConfirm } from '@/service/apps'
import { post } from '@/service/base'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { buildDifyAgentTools } from '../tools'

vi.mock('@/service/apps', () => ({
  createApp: vi.fn(),
  exportAppConfig: vi.fn(),
  importDSL: vi.fn(),
  importDSLConfirm: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  post: vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn(),
}))

const getTool = (name: string) => {
  const tool = buildDifyAgentTools().find(tool => tool.name === name)
  if (!tool)
    throw new Error(`Missing tool ${name}`)

  return tool
}

describe('agent context tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/app/app-123/workflow')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should expose high-level workflow orchestration tools', () => {
    const names = buildDifyAgentTools().map(tool => tool.name)

    expect(names).toEqual(expect.arrayContaining([
      'dify_explain_workflow_schema',
      'dify_validate_workflow_graph',
      'dify_get_workflow_node_default_config',
      'dify_get_workflow_draft',
      'dify_sync_workflow_draft',
      'dify_run_workflow_draft',
      'dify_run_workflow_node',
      'dify_get_workflow_runs',
      'dify_get_workflow_run_detail',
      'dify_get_workflow_run_node_executions',
      'dify_stop_workflow_run',
      'dify_create_workflow_app',
      'dify_search_marketplace_plugins',
      'dify_list_installed_plugin_capabilities',
      'dify_list_mcp_adapted_plugin_tools',
      'dify_get_plugin_tool_credential_info',
      'dify_build_plugin_tool_workflow_node',
      'dify_get_plugin_task_detail',
      'dify_uninstall_plugin',
      'dify_get_trigger_provider_detail',
      'dify_create_trigger_subscription_builder',
      'dify_get_trigger_subscription_builder_logs',
      'dify_get_app_triggers',
      'dify_import_app_dsl',
      'dify_publish_workflow',
      'dify_export_app_dsl',
    ]))
  })

  it('should explain workflow schema for non-visual agents', async () => {
    const result = await getTool('dify_explain_workflow_schema').execute()

    expect(result).toMatchObject({
      graph_contract: expect.any(Object),
      node_types: expect.objectContaining({
        control_flow: expect.any(Array),
        data_and_tools: expect.any(Array),
        terminal: expect.any(Array),
      }),
    })
  })

  it('should validate the current draft workflow graph', async () => {
    vi.mocked(fetchWorkflowDraft).mockResolvedValue({
      conversation_variables: [],
      created_at: 1710000000,
      created_by: { email: 'owner@example.com', id: 'account-1', name: 'Owner' },
      environment_variables: [],
      graph: {
        edges: [],
        nodes: [
          {
            data: {
              desc: '',
              title: 'Start',
              type: BlockEnum.Start,
            },
            id: 'start',
            position: { x: 0, y: 0 },
            type: 'custom',
          },
        ],
      },
      hash: 'hash-1',
      id: 'workflow-1',
      marked_comment: '',
      marked_name: '',
      tool_published: false,
      updated_at: 1710000001,
      updated_by: { email: 'owner@example.com', id: 'account-1', name: 'Owner' },
      version: 'draft',
    })

    const result = await getTool('dify_validate_workflow_graph').execute()

    expect(fetchWorkflowDraft).toHaveBeenCalledWith('/apps/app-123/workflows/draft')
    expect(result).toMatchObject({
      app_id: 'app-123',
      analysis: {
        graph: {
          issues: [
            expect.objectContaining({
              code: 'missing_terminal_node',
            }),
          ],
          node_count: 1,
        },
      },
      ok: true,
      source: 'draft',
    })
  })

  it('should fetch workflow node default config', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      config: {
        title: 'LLM',
        type: BlockEnum.LLM,
      },
      type: BlockEnum.LLM,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_get_workflow_node_default_config').execute({
      block_type: BlockEnum.LLM,
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/apps/app-123/workflows/default-workflow-block-configs/llm?q=%7B%7D'), expect.objectContaining({
      credentials: 'include',
    }))
    expect(result).toMatchObject({
      app_id: 'app-123',
      block_type: BlockEnum.LLM,
      config: {
        type: BlockEnum.LLM,
      },
      ok: true,
    })
  })

  it('should import app DSL and confirm pending version mismatch', async () => {
    vi.mocked(importDSL).mockResolvedValue({
      app_mode: AppModeEnum.WORKFLOW,
      current_dsl_version: '0.3.0',
      error: '',
      id: 'import-1',
      imported_dsl_version: '0.2.0',
      leaked_dependencies: [],
      status: DSLImportStatus.PENDING,
    })
    vi.mocked(importDSLConfirm).mockResolvedValue({
      app_id: 'new-app',
      app_mode: AppModeEnum.WORKFLOW,
      current_dsl_version: '0.3.0',
      error: '',
      id: 'import-1',
      imported_dsl_version: '0.2.0',
      leaked_dependencies: [],
      status: DSLImportStatus.COMPLETED,
    })

    const result = await getTool('dify_import_app_dsl').execute({
      navigate_to_workflow: false,
      yaml_content: 'app:\n  mode: workflow\n',
    })

    expect(importDSL).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'yaml-content',
      yaml_content: 'app:\n  mode: workflow\n',
    }))
    expect(importDSLConfirm).toHaveBeenCalledWith({ import_id: 'import-1' })
    expect(result).toMatchObject({
      app_id: 'new-app',
      ok: true,
      status: DSLImportStatus.COMPLETED,
    })
  })

  it('should create a workflow app without visual navigation', async () => {
    vi.mocked(createApp).mockResolvedValue({
      app_model_config: null,
      created_at: 1710000000,
      description: 'Plugin workflow',
      icon: '🤖',
      icon_background: '#D5F5F6',
      icon_type: 'emoji',
      id: 'new-workflow-app',
      max_active_requests: null,
      mode: AppModeEnum.WORKFLOW,
      name: 'Mercury to QuickBooks',
      site: null,
      tags: [],
      updated_at: 1710000000,
      use_icon_as_answer_icon: false,
    } as unknown as Awaited<ReturnType<typeof createApp>>)

    const result = await getTool('dify_create_workflow_app').execute({
      description: 'Plugin workflow',
      name: 'Mercury to QuickBooks',
      navigate_to_workflow: false,
    })

    expect(createApp).toHaveBeenCalledWith(expect.objectContaining({
      mode: AppModeEnum.WORKFLOW,
      name: 'Mercury to QuickBooks',
    }))
    expect(result).toMatchObject({
      app_id: 'new-workflow-app',
      app_url: '/app/new-workflow-app/workflow',
      ok: true,
    })
  })

  it('should search Marketplace plugins for plugin-aware workflow construction', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        page: 1,
        page_size: 2,
        plugins: [
          {
            brief: { en_US: 'Mercury transaction trigger' },
            category: 'trigger',
            label: { en_US: 'Mercury Banking' },
            name: 'mercury_trigger',
            org: 'petrus',
            plugin_unique_identifier: 'petrus/mercury_trigger:0.4.9@hash',
            verified: true,
          },
        ],
        total: 1,
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_search_marketplace_plugins').execute({
      category: 'trigger',
      page_size: 2,
      query: 'Mercury',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/search/advanced'), expect.objectContaining({
      method: 'POST',
    }))
    expect(result).toMatchObject({
      ok: true,
      plugins: [
        expect.objectContaining({
          plugin_id: 'petrus/mercury_trigger',
          plugin_unique_identifier: 'petrus/mercury_trigger:0.4.9@hash',
        }),
      ],
      total: 1,
    })
  })

  it('should list installed plugin capabilities across tools and triggers', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/workspaces/current/triggers')) {
        return new Response(JSON.stringify([
          {
            events: [
              {
                identity: { label: { en_US: 'Transaction Activity' } },
                name: 'transaction',
                output_schema: { properties: { transaction_id: { type: 'string' } } },
                parameters: [{ name: 'operation_filter', required: false, type: 'select' }],
              },
            ],
            label: { en_US: 'Mercury Transaction Trigger' },
            name: 'petrus/mercury_trigger/mercury_trigger',
            plugin_id: 'petrus/mercury_trigger',
          },
        ]), { status: 200 })
      }
      if (url.includes('/workspaces/current/tools/builtin')) {
        return new Response(JSON.stringify([
          {
            id: 'petrus/quickbooks/quickbooks',
            label: { en_US: 'QuickBooks Online' },
            name: 'petrus/quickbooks/quickbooks',
            plugin_id: 'petrus/quickbooks',
            tools: [
              {
                label: { en_US: 'Record Expense' },
                name: 'create_purchase',
                parameters: [{ name: 'amount', required: true, type: 'number' }],
              },
            ],
            type: 'builtin',
          },
        ]), { status: 200 })
      }
      if (url.includes('/workspaces/current/plugin/list')) {
        return new Response(JSON.stringify({
          plugins: [
            {
              declaration: { category: 'tool', label: { en_US: 'QuickBooks Online' } },
              id: 'install-quickbooks',
              name: 'quickbooks',
              plugin_id: 'petrus/quickbooks',
              plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
              version: '0.2.10',
            },
          ],
          total: 1,
        }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_list_installed_plugin_capabilities').execute()

    expect(result).toMatchObject({
      catalog: {
        installed_plugins: {
          plugins: [
            expect.objectContaining({
              installation_id: 'install-quickbooks',
            }),
          ],
          total: 1,
        },
        tools: {
          builtin: [
            expect.objectContaining({
              plugin_id: 'petrus/quickbooks',
              tools: [
                expect.objectContaining({
                  name: 'create_purchase',
                  required_parameters: ['amount'],
                }),
              ],
            }),
          ],
        },
        triggers: [
          expect.objectContaining({
            plugin_id: 'petrus/mercury_trigger',
          }),
        ],
      },
      ok: true,
    })
  })

  it('should list installed Marketplace plugin tools as MCP-compatible definitions', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/credential/info')) {
        return new Response(JSON.stringify({
          credentials: [{ id: 'cred-1', name: 'Default' }],
          is_oauth_custom_client_enabled: false,
          supported_credential_types: ['OAUTH'],
        }), { status: 200 })
      }

      if (url.includes('/workspaces/current/tools/builtin')) {
        return new Response(JSON.stringify([
          {
            id: 'petrus/quickbooks/quickbooks',
            label: { en_US: 'QuickBooks Online' },
            name: 'petrus/quickbooks/quickbooks',
            plugin_id: 'petrus/quickbooks',
            plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
            tools: [
              {
                description: { en_US: 'Creates a purchase record.' },
                label: { en_US: 'Create Purchase' },
                name: 'create_purchase',
                output_schema: {
                  properties: {
                    purchase_id: { type: 'string' },
                  },
                  type: 'object',
                },
                parameters: [
                  {
                    llm_description: 'Purchase amount.',
                    name: 'amount',
                    required: true,
                    type: 'number',
                  },
                  {
                    name: 'account_id',
                    options: [
                      { label: { en_US: 'Checking' }, value: 'checking' },
                    ],
                    required: false,
                    type: 'select',
                  },
                ],
              },
            ],
            type: 'builtin',
          },
          {
            id: 'langgenius/google/google',
            label: { en_US: 'Google' },
            name: 'langgenius/google/google',
            tools: [
              {
                label: { en_US: 'Search' },
                name: 'search',
                parameters: [],
              },
            ],
            type: 'builtin',
          },
        ]), { status: 200 })
      }

      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_list_mcp_adapted_plugin_tools').execute({
      include_credential_info: true,
      plugin_id: 'petrus/quickbooks',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/tools/builtin'), expect.any(Object))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/tool-provider/builtin/petrus%2Fquickbooks%2Fquickbooks/credential/info'), expect.any(Object))
    expect(result).toMatchObject({
      ok: true,
      provider_count: 1,
      protocol: 'mcp',
      providers: [
        expect.objectContaining({
          credential_info: expect.objectContaining({
            authorized: true,
          }),
          plugin_id: 'petrus/quickbooks',
          tool_count: 1,
        }),
      ],
      tool_count: 1,
      tools: [
        expect.objectContaining({
          dify: expect.objectContaining({
            provider_id: 'petrus/quickbooks/quickbooks',
            provider_type: 'builtin',
            tool_name: 'create_purchase',
          }),
          inputSchema: {
            additionalProperties: false,
            properties: {
              account_id: {
                enum: ['checking'],
                type: 'string',
              },
              amount: {
                description: 'Purchase amount.',
                type: 'number',
              },
            },
            required: ['amount'],
            type: 'object',
          },
          name: 'dify_plugin__petrus_quickbooks_quickbooks__create_purchase',
          outputSchema: {
            properties: {
              purchase_id: { type: 'string' },
            },
            type: 'object',
          },
        }),
      ],
    })
  })

  it('should fetch plugin tool credential info', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      credentials: [{ id: 'cred-1' }],
      supported_credential_types: ['API_KEY'],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_get_plugin_tool_credential_info').execute({
      provider: 'petrus/quickbooks/quickbooks',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/tool-provider/builtin/petrus%2Fquickbooks%2Fquickbooks/credential/info'), expect.objectContaining({
      credentials: 'include',
    }))
    expect(result).toMatchObject({
      authorized: true,
      ok: true,
      provider: 'petrus/quickbooks/quickbooks',
    })
  })

  it('should build a Marketplace plugin workflow tool node', async () => {
    const result = await getTool('dify_build_plugin_tool_workflow_node').execute({
      constant_parameters: {
        amount: 42,
      },
      node_id: 'quickbooks-create-purchase',
      plugin_id: 'petrus/quickbooks',
      plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
      provider_id: 'petrus/quickbooks/quickbooks',
      tool_label: 'Create Purchase',
      tool_name: 'create_purchase',
    })

    expect(result).toMatchObject({
      mcp_tool_name: 'dify_plugin__petrus_quickbooks_quickbooks__create_purchase',
      node: {
        data: {
          plugin_id: 'petrus/quickbooks',
          plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
          provider_id: 'petrus/quickbooks/quickbooks',
          provider_type: 'builtin',
          tool_label: 'Create Purchase',
          tool_name: 'create_purchase',
          tool_node_version: '2',
          tool_parameters: {
            amount: {
              type: 'constant',
              value: 42,
            },
          },
          type: 'tool',
        },
        id: 'quickbooks-create-purchase',
        type: 'custom',
      },
      ok: true,
    })
  })

  it('should return next steps when installing Marketplace plugins', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: 'task-1',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_install_marketplace_plugins').execute({
      plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/plugin/install/marketplace'), expect.objectContaining({
      body: JSON.stringify({
        plugin_unique_identifiers: ['petrus/quickbooks:0.2.10@hash'],
      }),
      method: 'POST',
    }))
    expect(result).toMatchObject({
      next_steps: expect.arrayContaining([
        expect.stringContaining('dify_get_plugin_task_detail'),
        expect.stringContaining('dify_list_mcp_adapted_plugin_tools'),
      ]),
      ok: true,
      task_id: 'task-1',
    })
  })

  it('should fetch plugin task detail by task id', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_get_plugin_task_detail').execute({
      task_id: 'task-1',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/plugin/tasks/task-1'), expect.objectContaining({
      credentials: 'include',
    }))
    expect(result).toMatchObject({
      ok: true,
      status: 'success',
      task_id: 'task-1',
    })
  })

  it('should uninstall plugin by installation id', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_uninstall_plugin').execute({
      plugin_installation_id: 'install-quickbooks',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/plugin/uninstall'), expect.objectContaining({
      body: JSON.stringify({
        plugin_installation_id: 'install-quickbooks',
      }),
      method: 'POST',
    }))
    expect(result).toMatchObject({
      ok: true,
      plugin_installation_id: 'install-quickbooks',
      post_uninstall_next_steps: expect.arrayContaining([
        expect.stringContaining('dify_list_installed_plugin_capabilities'),
      ]),
    })
  })

  it('should resolve installed plugin before uninstalling by unique identifier', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/workspaces/current/plugin/list')) {
        return new Response(JSON.stringify({
          plugins: [
            {
              id: 'install-quickbooks',
              plugin_id: 'petrus/quickbooks',
              plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
            },
          ],
        }), { status: 200 })
      }

      return new Response(JSON.stringify({
        success: true,
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_uninstall_plugin').execute({
      plugin_unique_identifier: 'petrus/quickbooks:0.2.10@hash',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/plugin/list?page=1&page_size=100'), expect.any(Object))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/workspaces/current/plugin/uninstall'), expect.objectContaining({
      body: JSON.stringify({
        plugin_installation_id: 'install-quickbooks',
      }),
    }))
    expect(result).toMatchObject({
      ok: true,
      plugin_installation_id: 'install-quickbooks',
    })
  })

  it('should sync workflow draft and return preflight validation', async () => {
    vi.mocked(post).mockResolvedValue({
      hash: 'hash-2',
      result: 'success',
      updated_at: 1710000002,
    })
    const graph = {
      edges: [
        {
          data: {
            sourceType: BlockEnum.Start,
            targetType: BlockEnum.End,
          },
          id: 'edge-start-end',
          source: 'start',
          target: 'end',
        },
      ],
      nodes: [
        {
          data: {
            desc: '',
            title: 'Start',
            type: BlockEnum.Start,
          },
          id: 'start',
          position: { x: 0, y: 0 },
          type: 'custom',
        },
        {
          data: {
            desc: '',
            title: 'End',
            type: BlockEnum.End,
          },
          id: 'end',
          position: { x: 300, y: 0 },
          type: 'custom',
        },
      ],
    }

    const result = await getTool('dify_sync_workflow_draft').execute({
      graph,
    })

    expect(post).toHaveBeenCalledWith(
      'apps/app-123/workflows/draft',
      {
        body: {
          conversation_variables: [],
          environment_variables: [],
          features: {},
          graph,
        },
      },
      { silent: true },
    )
    expect(result).toMatchObject({
      app_id: 'app-123',
      hash: 'hash-2',
      ok: true,
      preflight_validation: {
        error_count: 0,
        valid: true,
        warning_count: 0,
      },
    })
  })

  it('should publish workflow for the current app route', async () => {
    vi.mocked(post).mockResolvedValue({
      created_at: 1710000000,
      result: 'success',
    })

    const result = await getTool('dify_publish_workflow').execute({
      marked_comment: 'release notes',
      marked_name: 'finance release',
    })

    expect(post).toHaveBeenCalledWith('apps/app-123/workflows/publish', {
      body: {
        marked_comment: 'release notes',
        marked_name: 'finance release',
      },
    })
    expect(result).toMatchObject({
      app_id: 'app-123',
      ok: true,
    })
  })

  it('should export app DSL for the current route', async () => {
    vi.mocked(exportAppConfig).mockResolvedValue({ data: 'app:\n  mode: workflow\n' })

    const result = await getTool('dify_export_app_dsl').execute()

    expect(exportAppConfig).toHaveBeenCalledWith({
      appID: 'app-123',
      include: false,
      workflowID: undefined,
    })
    expect(result).toMatchObject({
      app_id: 'app-123',
      ok: true,
      yaml_content: 'app:\n  mode: workflow\n',
    })
  })

  it('should run workflow draft and parse streaming events', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response([
      'data: {"event":"workflow_started","task_id":"task-1","workflow_run_id":"run-1","data":{"id":"run-1"}}\n\n',
      'data: {"event":"node_finished","task_id":"task-1","workflow_run_id":"run-1","data":{"node_id":"start","status":"succeeded"}}\n\n',
      'data: {"event":"workflow_finished","task_id":"task-1","workflow_run_id":"run-1","data":{"status":"succeeded","outputs":{"result":"ok"}}}\n\n',
    ].join(''), {
      headers: {
        'Content-Type': 'text/event-stream',
      },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_run_workflow_draft').execute({
      inputs: { query: 'test' },
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/apps/app-123/workflows/draft/run'), expect.objectContaining({
      method: 'POST',
    }))
    expect(result).toMatchObject({
      app_id: 'app-123',
      ok: true,
      summary: {
        event_count: 3,
        status: 'succeeded',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
      },
    })
  })

  it('should fetch workflow run node executions', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        {
          node_id: 'start',
          status: 'succeeded',
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    const result = await getTool('dify_get_workflow_run_node_executions').execute({
      run_id: 'run-1',
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/console/api/apps/app-123/workflow-runs/run-1/node-executions'), expect.objectContaining({
      credentials: 'include',
    }))
    expect(result).toMatchObject({
      app_id: 'app-123',
      data: [
        {
          node_id: 'start',
        },
      ],
      ok: true,
      run_id: 'run-1',
    })
  })
})
