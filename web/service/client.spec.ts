import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { MutationFunctionContext, QueryFunctionContext } from '@tanstack/react-query'
import type { consoleQuery as ConsoleQuery } from './client'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConsoleOpenAPIURL } from './console-openapi-url'

const loadGetBaseURL = async (isClientValue: boolean) => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: isClientValue, isServer: !isClientValue }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const module = await import('./client')
  warnSpy.mockClear()
  return { getBaseURL: module.getBaseURL, warnSpy }
}

const loadConsoleQuery = async () => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const module = await import('./client')
  warnSpy.mockRestore()
  return module.consoleQuery
}

const loadConsoleQueryWithRequest = async (request: ReturnType<typeof vi.fn>) => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  vi.doMock('./base', () => ({ request }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const module = await import('./client')
  warnSpy.mockRestore()
  return module.consoleQuery
}

const createMutationContext = (queryClient: QueryClient): MutationFunctionContext => ({
  client: queryClient,
  meta: undefined,
})

const createTag = (overrides: Partial<Tag> = {}): Tag => ({
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: '1',
  ...overrides,
})

const createApiBasedExtension = (
  overrides: Partial<ApiBasedExtensionResponse> = {},
): ApiBasedExtensionResponse => ({
  id: 'extension-1',
  name: 'Weather',
  api_endpoint: 'https://api.example.com/weather',
  api_key: 'secret-key',
  ...overrides,
})

type AgentMutationResponse = Parameters<
  NonNullable<ReturnType<typeof ConsoleQuery.agent.post.mutationOptions>['onSuccess']>
>[0]
type AgentComposerMutationResponse = Parameters<
  NonNullable<
    ReturnType<typeof ConsoleQuery.agent.byAgentId.composer.put.mutationOptions>['onSuccess']
  >
>[0]
type AgentPublishMutationResponse = Parameters<
  NonNullable<
    ReturnType<typeof ConsoleQuery.agent.byAgentId.publish.post.mutationOptions>['onSuccess']
  >
>[0]
type WorkflowAgentComposerMutationResponse = Parameters<
  NonNullable<
    ReturnType<
      typeof ConsoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post.mutationOptions
    >['onSuccess']
  >
>[0]
type RetryFn = (failureCount: number, error: unknown) => boolean

const getRetryFn = (queryOptions: object): RetryFn => {
  const retry = (queryOptions as { retry?: unknown }).retry
  expect(typeof retry).toBe('function')
  if (typeof retry !== 'function') throw new TypeError('Expected query retry to be a function.')

  return retry as RetryFn
}

const createAgent = (overrides: Partial<AgentMutationResponse> = {}): AgentMutationResponse => ({
  ...overrides,
  active_config_is_published: overrides.active_config_is_published ?? false,
  debug_conversation_has_messages: overrides.debug_conversation_has_messages ?? false,
  debug_conversation_message_count: overrides.debug_conversation_message_count ?? 0,
  enable_api: overrides.enable_api ?? true,
  enable_site: overrides.enable_site ?? true,
  description: overrides.description ?? 'Agent description',
  hidden_app_backed: overrides.hidden_app_backed ?? false,
  id: overrides.id ?? 'agent-1',
  icon_url: overrides.icon_url ?? null,
  mode: overrides.mode ?? 'agent',
  name: overrides.name ?? 'Agent',
  role: overrides.role ?? 'Assistant',
})

const createComposerState = (
  overrides: Partial<AgentComposerMutationResponse> = {},
): AgentComposerMutationResponse => ({
  active_config_snapshot: {
    id: 'snapshot-1',
    version: 1,
  },
  agent: {
    active_config_snapshot_id: 'snapshot-1',
    description: 'Agent description',
    hidden_app_backed: false,
    id: 'agent-1',
    name: 'Agent',
    scope: 'roster',
    status: 'active',
  },
  agent_soul: {
    config_note: '',
    schema_version: 1,
  },
  hidden_app_backed: false,
  save_options: ['save_to_current_version', 'save_as_new_version'],
  variant: 'agent_app',
  ...overrides,
})

const createAgentPublishResponse = (
  overrides: Partial<AgentPublishMutationResponse> = {},
): AgentPublishMutationResponse => ({
  active_config_snapshot: {
    id: 'snapshot-1',
    version: 1,
  },
  active_config_snapshot_id: 'snapshot-1',
  result: 'success',
  ...overrides,
})

const createWorkflowComposerState = (
  overrides: Partial<WorkflowAgentComposerMutationResponse> = {},
): WorkflowAgentComposerMutationResponse => ({
  agent: {
    active_config_snapshot_id: 'snapshot-1',
    description: 'Agent description',
    hidden_app_backed: false,
    id: 'agent-1',
    name: 'Agent',
    scope: 'roster',
    status: 'active',
  },
  agent_soul: {
    config_note: '',
    schema_version: 1,
  },
  debug_conversation_has_messages: overrides.debug_conversation_has_messages ?? false,
  debug_conversation_message_count: overrides.debug_conversation_message_count ?? 0,
  hidden_app_backed: false,
  binding: {
    agent_id: 'agent-1',
    binding_type: 'roster_agent',
    current_snapshot_id: 'snapshot-1',
    id: 'binding-1',
    node_id: 'node-1',
    workflow_id: 'workflow-1',
  },
  node_job: {
    mode: 'tell_agent_what_to_do',
    schema_version: 1,
    workflow_prompt: '',
  },
  save_options: ['node_job_only', 'save_as_new_agent'],
  soul_lock: {
    can_unlock: false,
    locked: true,
  },
  variant: 'workflow',
  ...overrides,
})

// Scenario: base URL selection and warnings.
describe('getBaseURL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Scenario: client environment uses window origin.
  it('should use window origin when running on the client', async () => {
    // Arrange
    const { origin } = window.location
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('/api')

    // Assert
    expect(url.href).toBe(`${origin}/api`)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // Scenario: server environment falls back to localhost with warning.
  it('should fall back to localhost and warn on the server', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(false)

    // Act
    const url = getBaseURL('/api')

    // Assert
    expect(url.href).toBe('http://localhost/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'Using localhost as base URL in server environment, please configure accordingly.',
    )
  })

  // Scenario: non-http protocols surface warnings.
  it('should warn when protocol is not http or https', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('localhost:5001/console/api')

    // Assert
    expect(url.protocol).toBe('localhost:')
    expect(url.href).toBe('localhost:5001/console/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'Unexpected protocol for API requests, expected http or https. Current protocol: localhost:. Please configure accordingly.',
    )
  })

  // Scenario: absolute http URLs are preserved.
  it('should keep absolute http URLs intact', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('https://api.example.com/console/api')

    // Assert
    expect(url.href).toBe('https://api.example.com/console/api')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// Scenario: oRPC operation context controls transport behavior without handwritten REST helpers.
describe('consoleQuery transport context', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should forward silent context to the base request transport', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    )
    const consoleQuery = await loadConsoleQueryWithRequest(request)
    const queryOptions = consoleQuery.agent.byAgentId.buildDraft.get.queryOptions({
      input: {
        params: {
          agent_id: 'agent-1',
        },
      },
      context: {
        silent: true,
      },
    })

    await Promise.resolve(
      queryOptions.queryFn({ signal: new AbortController().signal } as QueryFunctionContext),
    ).catch(() => undefined)

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/agent/agent-1/build-draft'),
      expect.any(Object),
      expect.objectContaining({
        fetchCompat: true,
        silent: true,
      }),
    )
  })

  it('should serialize trial app dataset ids as repeated query params', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
          has_more: false,
          limit: 20,
          page: 1,
          total: 0,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    )
    const consoleQuery = await loadConsoleQueryWithRequest(request)
    const queryOptions = consoleQuery.trialApps.byAppId.datasets.get.queryOptions({
      input: {
        params: {
          app_id: 'app-1',
        },
        query: {
          ids: ['id-1', 'id-2'],
        },
      },
    })

    await queryOptions.queryFn({ signal: new AbortController().signal } as QueryFunctionContext)

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/trial-apps/app-1/datasets?ids=id-1&ids=id-2'),
      expect.any(Object),
      expect.objectContaining({
        fetchCompat: true,
      }),
    )
    expect(request.mock.calls[0]![0]).not.toContain('ids%5B0%5D')
  })
})

// Scenario: console OpenAPI query arrays follow backend parser expectations.
describe('normalizeConsoleOpenAPIURL', () => {
  it('should serialize repeated-only query arrays as repeated params', () => {
    const url = normalizeConsoleOpenAPIURL(
      'https://example.com/console/api/agent/agent-1/logs?sources%5B1%5D=debug&sources%5B0%5D=api&statuses%5B0%5D=success&keyword=test',
    )
    const searchParams = new URL(url).searchParams

    expect(searchParams.getAll('sources')).toEqual(['api', 'debug'])
    expect(searchParams.getAll('statuses')).toEqual(['success'])
    expect(searchParams.get('keyword')).toBe('test')
    expect(searchParams.has('sources[0]')).toBe(false)
    expect(searchParams.has('statuses[0]')).toBe(false)
  })

  it('should serialize app list query arrays as repeated params', () => {
    const url = normalizeConsoleOpenAPIURL(
      'https://example.com/console/api/apps?tag_ids%5B0%5D=tag-1&creator_ids%5B0%5D=user-1',
    )
    const searchParams = new URL(url).searchParams

    expect(searchParams.getAll('tag_ids')).toEqual(['tag-1'])
    expect(searchParams.getAll('creator_ids')).toEqual(['user-1'])
    expect(searchParams.has('tag_ids[0]')).toBe(false)
    expect(searchParams.has('creator_ids[0]')).toBe(false)
  })

  it('should serialize snippet list query arrays as repeated params', () => {
    const url = normalizeConsoleOpenAPIURL(
      'https://example.com/console/api/workspaces/current/customized-snippets?tag_ids%5B0%5D=tag-1&creators%5B0%5D=user-1',
    )
    const searchParams = new URL(url).searchParams

    expect(searchParams.getAll('tag_ids')).toEqual(['tag-1'])
    expect(searchParams.getAll('creators')).toEqual(['user-1'])
    expect(searchParams.has('tag_ids[0]')).toBe(false)
    expect(searchParams.has('creators[0]')).toBe(false)
  })
})

// Scenario: oRPC query defaults own shared Agent detail fetch behavior.
describe('consoleQuery agent query defaults', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not retry missing agent detail errors', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryOptions = consoleQuery.agent.byAgentId.get.queryOptions({
      input: {
        params: {
          agent_id: 'agent-1',
        },
      },
    })
    const retry = getRetryFn(queryOptions)

    expect(retry(0, new Response(null, { status: 404 }))).toBe(false)
  })

  it('should retry other agent detail errors fewer than three times', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryOptions = consoleQuery.agent.byAgentId.get.queryOptions({
      input: {
        params: {
          agent_id: 'agent-1',
        },
      },
    })
    const retry = getRetryFn(queryOptions)

    expect(retry(2, new Error('temporary failure'))).toBe(true)
    expect(retry(3, new Error('temporary failure'))).toBe(false)
  })
})

// Scenario: oRPC mutation defaults own shared Agent roster cache behavior.
describe('consoleQuery agent mutation defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should invalidate roster and invite option lists after creating an agent', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const createdAgent = createAgent()

    const mutationOptions = consoleQuery.agent.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      createdAgent,
      {
        body: {
          name: createdAgent.name,
          description: createdAgent.description,
          role: createdAgent.role ?? 'Assistant',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
  })

  it('should cache copied agent detail and invalidate roster lists after copying an agent', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const copiedAgent = createAgent({ id: 'copied-agent', name: 'Agent copy' })

    const mutationOptions = consoleQuery.agent.byAgentId.copy.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      copiedAgent,
      {
        params: {
          agent_id: 'source-agent',
        },
        body: {},
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(
      queryClient.getQueryData(
        consoleQuery.agent.byAgentId.get.queryKey({
          input: {
            params: {
              agent_id: copiedAgent.id,
            },
          },
        }),
      ),
    ).toEqual(copiedAgent)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
  })

  it('should cache workflow composer state after copying a roster agent into an inline agent', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const composerState = createWorkflowComposerState({
      binding: {
        agent_id: 'inline-agent-1',
        binding_type: 'inline_agent',
        current_snapshot_id: 'inline-snapshot-1',
        id: 'binding-1',
        node_id: 'node-1',
        workflow_id: 'workflow-1',
      },
    })

    const mutationOptions =
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.copyFromRoster.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      composerState,
      {
        params: {
          app_id: 'app-1',
          node_id: 'node-1',
        },
        body: {
          source_agent_id: 'roster-agent-1',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(
      queryClient.getQueryData(
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: {
            params: {
              app_id: 'app-1',
              node_id: 'node-1',
            },
          },
        }),
      ),
    ).toEqual(composerState)
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.get.key(),
    })
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
  })

  it('should cache workflow composer state after saving workflow node composer', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const composerState = createWorkflowComposerState({
      binding: {
        agent_id: 'inline-agent-1',
        binding_type: 'inline_agent',
        current_snapshot_id: 'inline-snapshot-1',
        id: 'binding-1',
        node_id: 'node-1',
        workflow_id: 'workflow-1',
      },
    })

    const mutationOptions =
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions()
    await mutationOptions.onSuccess?.(
      composerState,
      {
        params: {
          app_id: 'app-1',
          node_id: 'node-1',
        },
        body: {
          variant: 'workflow',
          save_strategy: 'node_job_only',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(
      queryClient.getQueryData(
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: {
            params: {
              app_id: 'app-1',
              node_id: 'node-1',
            },
          },
        }),
      ),
    ).toEqual(composerState)
  })

  it('should cache workflow composer state and invalidate roster lists after saving inline agent to roster', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const composerState = createWorkflowComposerState()

    const mutationOptions =
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      composerState,
      {
        params: {
          app_id: 'app-1',
          node_id: 'node-1',
        },
        body: {
          variant: 'workflow',
          save_strategy: 'save_to_roster',
          new_agent_name: 'Saved Agent',
          description: 'Agent description',
          role: 'Assistant',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(
      queryClient.getQueryData(
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: {
            params: {
              app_id: 'app-1',
              node_id: 'node-1',
            },
          },
        }),
      ),
    ).toEqual(composerState)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.byAgentId.get.queryKey({
        input: {
          params: {
            agent_id: 'agent-1',
          },
        },
      }),
    })
  })

  it('should invalidate invite option lists after updating an agent', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const updatedAgent = createAgent({ name: 'Updated Agent' })

    const mutationOptions = consoleQuery.agent.byAgentId.put.mutationOptions()
    await mutationOptions.onSuccess?.(
      updatedAgent,
      {
        params: {
          agent_id: updatedAgent.id,
        },
        body: {
          name: updatedAgent.name,
          role: updatedAgent.role ?? 'Assistant',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
  })

  it('should invalidate roster and invite option lists after publishing an agent config', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const inviteOptionsQueryKey = consoleQuery.agent.inviteOptions.get.queryKey({
      input: {
        query: {
          app_id: 'app-1',
          limit: 8,
          page: 1,
        },
      },
    })
    queryClient.setQueryData(inviteOptionsQueryKey, {
      data: [
        {
          active_config_is_published: true,
          active_config_snapshot: null,
          active_config_snapshot_id: 'snapshot-1',
          agent_kind: 'dify_agent',
          app_id: null,
          archived_at: null,
          archived_by: null,
          created_at: 1,
          created_by: null,
          description: 'Agent description',
          existing_node_ids: [],
          hidden_app_backed: false,
          icon: null,
          icon_background: null,
          icon_type: null,
          id: 'agent-1',
          in_current_workflow_count: 0,
          is_in_current_workflow: false,
          name: 'Agent',
          published_node_reference_count: 0,
          published_reference_count: 0,
          published_references: [],
          role: '',
          scope: 'roster',
          source: 'workflow',
          status: 'active',
          updated_at: 1,
          updated_by: null,
          workflow_id: null,
          workflow_node_id: null,
        },
      ],
      has_more: false,
      limit: 8,
      page: 1,
      total: 1,
    })

    const mutationOptions = consoleQuery.agent.byAgentId.publish.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      createAgentPublishResponse(),
      {
        params: {
          agent_id: 'agent-1',
        },
        body: {},
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
    expect(queryClient.getQueryData(inviteOptionsQueryKey)).toBeUndefined()
  })

  it('should invalidate roster list but keep invite options stable after saving an agent draft', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const mutationOptions = consoleQuery.agent.byAgentId.composer.put.mutationOptions()
    await mutationOptions.onSuccess?.(
      createComposerState(),
      {
        params: {
          agent_id: 'agent-1',
        },
        body: {
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: {
            schema_version: 1,
          },
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.get.key(),
    })
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
  })

  it('should invalidate invite option lists after deleting an agent', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const deletedAgent = createAgent()

    const mutationOptions = consoleQuery.agent.byAgentId.delete.mutationOptions()
    await mutationOptions.onSuccess?.(
      {},
      {
        params: {
          agent_id: deletedAgent.id,
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.inviteOptions.get.key(),
    })
  })
})

// Scenario: oRPC mutation defaults own shared tag cache behavior.
describe('consoleQuery tag mutation defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should add created tags to the matching list query cache', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const appListKey = consoleQuery.tags.get.queryKey({
      input: {
        query: {
          type: 'app',
        },
      },
    })
    const knowledgeListKey = consoleQuery.tags.get.queryKey({
      input: {
        query: {
          type: 'knowledge',
        },
      },
    })
    const existingAppTag = createTag({ id: 'tag-1', name: 'Existing' })
    const existingKnowledgeTag = createTag({
      id: 'knowledge-tag-1',
      name: 'Knowledge',
      type: 'knowledge',
    })
    const createdTag = createTag({ id: 'tag-2', name: 'Created' })

    queryClient.setQueryData(appListKey, [existingAppTag])
    queryClient.setQueryData(knowledgeListKey, [existingKnowledgeTag])

    const mutationOptions = consoleQuery.tags.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      createdTag,
      {
        body: {
          name: createdTag.name,
          type: 'app',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(appListKey)).toEqual([createdTag, existingAppTag])
    expect(queryClient.getQueryData(knowledgeListKey)).toEqual([existingKnowledgeTag])
  })

  it('should update matching tags across cached list queries', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const appListKey = consoleQuery.tags.get.queryKey({
      input: {
        query: {
          type: 'app',
        },
      },
    })
    const knowledgeListKey = consoleQuery.tags.get.queryKey({
      input: {
        query: {
          type: 'knowledge',
        },
      },
    })
    const targetTag = createTag({ id: 'tag-1', name: 'Before' })
    const otherTag = createTag({ id: 'tag-2', name: 'Other' })
    const knowledgeTag = createTag({
      id: 'knowledge-tag-1',
      name: 'Knowledge',
      type: 'knowledge',
    })

    queryClient.setQueryData(appListKey, [targetTag, otherTag])
    queryClient.setQueryData(knowledgeListKey, [knowledgeTag])

    const updatedTag = createTag({
      ...targetTag,
      name: 'After',
      binding_count: '5',
    })
    const mutationOptions = consoleQuery.tags.byTagId.patch.mutationOptions()
    await mutationOptions.onSuccess?.(
      updatedTag,
      {
        params: {
          tag_id: targetTag.id,
        },
        body: {
          name: 'Ignored Client Name',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(appListKey)).toEqual([updatedTag, otherTag])
    expect(queryClient.getQueryData(knowledgeListKey)).toEqual([knowledgeTag])
  })

  it('should remove deleted tags across cached list queries', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const appListKey = consoleQuery.tags.get.queryKey({
      input: {
        query: {
          type: 'app',
        },
      },
    })
    const knowledgeListKey = consoleQuery.tags.get.queryKey({
      input: {
        query: {
          type: 'knowledge',
        },
      },
    })
    const deletedTag = createTag({ id: 'tag-1', name: 'Delete me' })
    const remainingTag = createTag({ id: 'tag-2', name: 'Keep me' })
    const knowledgeTag = createTag({
      id: 'knowledge-tag-1',
      name: 'Knowledge',
      type: 'knowledge',
    })

    queryClient.setQueryData(appListKey, [deletedTag, remainingTag])
    queryClient.setQueryData(knowledgeListKey, [knowledgeTag])

    const mutationOptions = consoleQuery.tags.byTagId.delete.mutationOptions()
    await mutationOptions.onSuccess?.(
      undefined,
      {
        params: {
          tag_id: deletedTag.id,
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(appListKey)).toEqual([remainingTag])
    expect(queryClient.getQueryData(knowledgeListKey)).toEqual([knowledgeTag])
  })
})

// Scenario: oRPC mutation defaults own shared API Extension cache behavior.
describe('consoleQuery apiBasedExtension mutation defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should add created API Extension to the list query cache', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const listKey = consoleQuery.apiBasedExtension.get.queryKey()
    const existingExtension = createApiBasedExtension({ id: 'extension-1', name: 'Existing' })
    const createdExtension = createApiBasedExtension({ id: 'extension-2', name: 'Created' })

    queryClient.setQueryData(listKey, [existingExtension])

    const mutationOptions = consoleQuery.apiBasedExtension.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      createdExtension,
      {
        body: {
          name: createdExtension.name,
          api_endpoint: createdExtension.api_endpoint,
          api_key: createdExtension.api_key,
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(listKey)).toEqual([createdExtension, existingExtension])
  })

  it('should update matching API Extension in the list query cache', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const listKey = consoleQuery.apiBasedExtension.get.queryKey()
    const targetExtension = createApiBasedExtension({ id: 'extension-1', name: 'Before' })
    const otherExtension = createApiBasedExtension({ id: 'extension-2', name: 'Other' })
    const updatedExtension = createApiBasedExtension({ ...targetExtension, name: 'After' })

    queryClient.setQueryData(listKey, [targetExtension, otherExtension])

    const mutationOptions = consoleQuery.apiBasedExtension.byId.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      updatedExtension,
      {
        params: {
          id: targetExtension.id,
        },
        body: {
          name: 'Ignored Client Name',
          api_endpoint: targetExtension.api_endpoint,
          api_key: '[__HIDDEN__]',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(listKey)).toEqual([updatedExtension, otherExtension])
  })

  it('should remove deleted API Extension from the list query cache', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const listKey = consoleQuery.apiBasedExtension.get.queryKey()
    const deletedExtension = createApiBasedExtension({ id: 'extension-1', name: 'Delete me' })
    const remainingExtension = createApiBasedExtension({ id: 'extension-2', name: 'Keep me' })

    queryClient.setQueryData(listKey, [deletedExtension, remainingExtension])

    const mutationOptions = consoleQuery.apiBasedExtension.byId.delete.mutationOptions()
    await mutationOptions.onSuccess?.(
      {},
      {
        params: {
          id: deletedExtension.id,
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(listKey)).toEqual([remainingExtension])
  })
})
