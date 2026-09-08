import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { AppDetail, AppSiteResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { DocumentProcessingTaskEvent } from '@dify/contracts/knowledge-fs/types.gen'
import type { MutationFunctionContext, QueryFunctionContext } from '@tanstack/react-query'
import type { consoleQuery as ConsoleQuery } from '@/service/console'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { normalizeConsoleOpenAPIURL } from './openapi-url'

const loadConsoleQuery = async () => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  const module = await import('@/service/console')
  return module.consoleQuery
}

const loadConsoleQueryWithRequest = async (request: ReturnType<typeof vi.fn>) => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  vi.doMock('../base', () => ({ request }))
  const module = await import('@/service/console')
  return module.consoleQuery
}

const loadConsoleQueryWithFetch = async () => {
  vi.resetModules()
  vi.doUnmock('../base')
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  const module = await import('@/service/console')
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
  access_ready: overrides.access_ready ?? true,
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
  active_config_is_published: false,
  active_config_snapshot: {
    id: 'snapshot-1',
    version: 1,
  },
  draft: {
    agent_id: 'agent-1',
    draft_type: 'draft',
    id: 'draft-1',
    updated_at: 1710000100,
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
  draft: {
    agent_id: 'agent-1',
    draft_type: 'draft',
    id: 'draft-1',
    updated_at: 1710000200,
  },
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

  it('should forward keepalive context to the base request transport', async () => {
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
        keepalive: true,
      },
    })

    await Promise.resolve(
      queryOptions.queryFn({ signal: new AbortController().signal } as QueryFunctionContext),
    ).catch(() => undefined)

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/agent/agent-1/build-draft'),
      expect.objectContaining({
        keepalive: true,
      }),
      expect.objectContaining({
        fetchCompat: true,
      }),
    )
  })

  it('should serialize trial app dataset ids as repeated query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    const consoleQuery = await loadConsoleQueryWithFetch()
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

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const resource = fetchSpy.mock.calls[0]![0]
    const requestURL = new URL(resource instanceof Request ? resource.url : resource.toString())
    expect(requestURL.searchParams.getAll('ids')).toEqual(['id-1', 'id-2'])
    expect(requestURL.searchParams.has('ids[0]')).toBe(false)
    expect(requestURL.searchParams.has('ids[1]')).toBe(false)
  })

  it('should consume KnowledgeFS processing events through the generated stream contract', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        [
          'id: task-1:1',
          'event: message',
          'data: {"event":"progress","data":{"progressPercent":25,"stage":"parsed","state":"running","updatedAt":"2026-07-22T10:00:00.000Z"}}',
          '',
          'id: task-1:terminal',
          'event: message',
          'data: {"event":"terminal","data":{"state":"succeeded"}}',
          '',
          '',
        ].join('\n'),
        {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
          },
        },
      ),
    )
    const consoleQuery = await loadConsoleQueryWithRequest(request)
    const queryOptions =
      consoleQuery.knowledgeFs.getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents.experimental_streamedOptions(
        {
          input: {
            headers: {
              'last-event-id': 'task-1:0',
            },
            params: {
              documentId: 'document-1',
              id: 'space-1',
              taskId: 'task-1',
            },
          },
        },
      )

    const events = await queryOptions.queryFn({
      client: new QueryClient(),
      signal: new AbortController().signal,
    } as QueryFunctionContext)

    expectTypeOf(events[0]!).toMatchTypeOf<DocumentProcessingTaskEvent>()
    expect(events).toEqual([
      {
        data: {
          progressPercent: 25,
          stage: 'parsed',
          state: 'running',
          updatedAt: '2026-07-22T10:00:00.000Z',
        },
        event: 'progress',
      },
      { data: { state: 'succeeded' }, event: 'terminal' },
    ])
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(
        '/knowledge-fs/knowledge-spaces/space-1/documents/document-1/processing-tasks/task-1/events',
      ),
      expect.any(Object),
      expect.objectContaining({
        fetchCompat: true,
      }),
    )
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

  it('should serialize plugin category tags as repeated params', () => {
    const url = normalizeConsoleOpenAPIURL(
      'https://example.com/console/api/workspaces/current/plugin/tool/list?tags%5B1%5D=rag&tags%5B0%5D=search',
    )
    const searchParams = new URL(url).searchParams

    expect(searchParams.getAll('tags')).toEqual(['search', 'rag'])
    expect(searchParams.has('tags[0]')).toBe(false)
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

describe('consoleQuery education defaults', () => {
  it('should not retry education status failures', async () => {
    const request = vi.fn().mockRejectedValue(new Error('education status failed'))
    const consoleQuery = await loadConsoleQueryWithRequest(request)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: 2 },
      },
    })

    await expect(
      queryClient.query(consoleQuery.account.education.get.queryOptions()),
    ).rejects.toThrow('education status failed')

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('should invalidate education status after activation succeeds', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await consoleQuery.account.education.post.mutationOptions().onSuccess?.(
      { message: 'success' },
      {
        body: {
          institution: 'Dify University',
          role: 'Student',
          token: 'education-token',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.account.education.get.key(),
    })
  })

  it('should preserve education status after activation is rejected', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await consoleQuery.account.education.post.mutationOptions().onSuccess?.(
      { message: 'failed' },
      {
        body: {
          institution: 'Dify University',
          role: 'Student',
          token: 'education-token',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).not.toHaveBeenCalled()
  })
})

describe('consoleQuery account profile mutation defaults', () => {
  it('should invalidate the account profile after a profile update', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await consoleQuery.account.profile.patch.mutationOptions().onSuccess?.(
      {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        avatar_url: null,
        is_password_set: true,
        timezone: 'Pacific/Midway',
      },
      { body: { timezone: 'Pacific/Midway' } },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.account.profile.get.key(),
    })
  })
})

describe('consoleQuery app mutation defaults', () => {
  it('should invalidate the exact app detail after access mutations', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => new Promise(() => {}))
    const context = createMutationContext(queryClient)
    const appDetail: AppDetail = {
      enable_api: true,
      enable_site: true,
      id: 'app-1',
      mode: 'chat',
      name: 'App',
    }
    const appSite: AppSiteResponse = {
      app_id: 'app-1',
      customize_token_strategy: 'fixed',
      default_language: 'en-US',
      prompt_public: false,
      show_workflow_steps: false,
      title: 'App',
      use_icon_as_answer_icon: false,
    }

    const results = [
      consoleQuery.apps.byAppId.apiEnable.post
        .mutationOptions()
        .onSettled?.(
          appDetail,
          null,
          { params: { app_id: 'app-1' }, body: { enable_api: true } },
          undefined,
          context,
        ),
      consoleQuery.apps.byAppId.siteEnable.post
        .mutationOptions()
        .onSettled?.(
          appDetail,
          null,
          { params: { app_id: 'app-2' }, body: { enable_site: true } },
          undefined,
          context,
        ),
      consoleQuery.apps.byAppId.site.accessTokenReset.post
        .mutationOptions()
        .onSettled?.(appSite, null, { params: { app_id: 'app-3' } }, undefined, context),
      consoleQuery.apps.byAppId.siteEnable.post
        .mutationOptions()
        .onSettled?.(
          undefined,
          new Error('request failed'),
          { params: { app_id: 'app-4' }, body: { enable_site: false } },
          undefined,
          context,
        ),
    ]

    expect(results).toEqual([undefined, undefined, undefined, undefined])
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byAppId.get.queryKey({
        input: { params: { app_id: 'app-1' } },
      }),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byAppId.get.queryKey({
        input: { params: { app_id: 'app-2' } },
      }),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byAppId.get.queryKey({
        input: { params: { app_id: 'app-3' } },
      }),
    })
  })

  it('should write an updated app into its exact detail cache', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const detailQueryKey = consoleQuery.apps.byAppId.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    })
    const otherDetailQueryKey = consoleQuery.apps.byAppId.get.queryKey({
      input: { params: { app_id: 'app-2' } },
    })
    const updatedApp = {
      enable_api: false,
      enable_site: false,
      icon_url: null,
      id: 'app-1',
      mode: 'chat',
      name: 'Updated app',
    }
    queryClient.setQueryData(detailQueryKey, { ...updatedApp, name: 'Old app' })
    queryClient.setQueryData(otherDetailQueryKey, { ...updatedApp, id: 'app-2', name: 'Other app' })

    const mutationOptions = consoleQuery.apps.byAppId.put.mutationOptions()
    await mutationOptions.onSuccess?.(
      updatedApp,
      {
        params: { app_id: 'app-1' },
        body: { name: updatedApp.name },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(detailQueryKey)).toEqual(updatedApp)
    expect(queryClient.getQueryData(otherDetailQueryKey)).toEqual({
      ...updatedApp,
      id: 'app-2',
      name: 'Other app',
    })
  })

  it.each([undefined, 'existing-app'])(
    'should refresh completed import data without blocking (overwrite: %s)',
    async (appId) => {
      const consoleQuery = await loadConsoleQuery()
      const queryClient = new QueryClient()
      const invalidateQueries = vi
        .spyOn(queryClient, 'invalidateQueries')
        .mockImplementation(() => new Promise(() => {}))
      const mutationOptions = consoleQuery.apps.imports.post.mutationOptions()

      const result = mutationOptions.onSuccess?.(
        {
          id: 'import-1',
          status: 'completed',
          app_id: 'app-1',
          current_dsl_version: '',
          imported_dsl_version: '',
          error: '',
        },
        { body: { mode: 'yaml-content', yaml_content: 'app: demo', app_id: appId } },
        undefined,
        createMutationContext(queryClient),
      )

      if (appId) {
        expect(invalidateQueries).not.toHaveBeenCalledWith({
          queryKey: consoleQuery.features.get.key(),
        })
      } else {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: consoleQuery.features.get.key(),
        })
      }
      expect(result).toBeUndefined()
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.get.key(),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  )

  it('should keep app lists intact while an import awaits confirmation', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const mutationOptions = consoleQuery.apps.imports.post.mutationOptions()

    mutationOptions.onSuccess?.(
      {
        id: 'import-1',
        status: 'pending',
        current_dsl_version: '1.0.0',
        imported_dsl_version: '2.0.0',
        error: '',
      },
      { body: { mode: 'yaml-content', yaml_content: 'app: demo' } },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('should keep a star mutation pending until visible app lists synchronize', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidationResolvers: Array<() => void> = []
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          invalidationResolvers.push(resolve)
        }),
    )
    const mutationOptions = consoleQuery.apps.byAppId.star.post.mutationOptions()

    const synchronization = mutationOptions.onSuccess?.(
      { result: 'success' },
      { params: { app_id: 'app-1' } },
      undefined,
      createMutationContext(queryClient),
    )
    let synchronized = false
    void Promise.resolve(synchronization).then(() => {
      synchronized = true
    })
    await Promise.resolve()

    expect(synchronized).toBe(false)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.starred.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(2)

    invalidationResolvers.forEach((resolve) => resolve())
    await synchronization

    expect(synchronized).toBe(true)
  })

  it('should wait for deleted app lists to synchronize without waiting for quota', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidationResolvers: Array<() => void> = []
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation((filters) => {
        if (JSON.stringify(filters?.queryKey) === JSON.stringify(consoleQuery.features.get.key()))
          return new Promise<void>(() => {})

        return new Promise<void>((resolve) => {
          invalidationResolvers.push(resolve)
        })
      })
    const mutationOptions = consoleQuery.apps.byAppId.delete.mutationOptions()

    const synchronization = mutationOptions.onSuccess?.(
      undefined,
      { params: { app_id: 'app-1' } },
      undefined,
      createMutationContext(queryClient),
    )
    let synchronized = false
    void Promise.resolve(synchronization).then(() => {
      synchronized = true
    })
    await Promise.resolve()

    expect(synchronized).toBe(false)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.starred.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.recent.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: consoleQuery.features.get.key() })
    expect(invalidateQueries).toHaveBeenCalledTimes(4)

    invalidationResolvers.forEach((resolve) => resolve())
    await synchronization

    expect(synchronized).toBe(true)
  })

  it('should invalidate the owning API key cache after app and dataset mutations', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => new Promise(() => {}))
    const context = createMutationContext(queryClient)

    const results = [
      consoleQuery.apps.byResourceId.apiKeys.post.mutationOptions().onSuccess?.(
        {
          id: 'app-key-1',
          token: 'app-token',
          type: 'app',
          dataset_ids: [],
        },
        { params: { resource_id: 'app-1' } },
        undefined,
        context,
      ),
      consoleQuery.datasets.apiKeys.post.mutationOptions().onSuccess?.(
        {
          id: 'dataset-key-1',
          token: 'dataset-token',
          type: 'dataset',
          dataset_ids: [],
        },
        { body: {} },
        undefined,
        context,
      ),
      consoleQuery.apps.byResourceId.apiKeys.byApiKeyId.delete
        .mutationOptions()
        .onSuccess?.(
          undefined,
          { params: { resource_id: 'app-1', api_key_id: 'app-key-1' } },
          undefined,
          context,
        ),
      consoleQuery.datasets.apiKeys.byApiKeyId.delete
        .mutationOptions()
        .onSuccess?.(undefined, { params: { api_key_id: 'dataset-key-1' } }, undefined, context),
    ]

    expect(results).toEqual([undefined, undefined, undefined, undefined])
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
        input: { params: { resource_id: 'app-1' } },
      }),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.datasets.apiKeys.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(4)
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

  it('should cache snippet composer state after saving the inline agent', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const composerState = createWorkflowComposerState({
      binding: {
        agent_id: 'snippet-inline-agent-1',
        binding_type: 'inline_agent',
        current_snapshot_id: 'snippet-inline-snapshot-1',
        id: 'binding-1',
        node_id: 'node-1',
        workflow_id: 'workflow-1',
      },
    })

    const mutationOptions =
      consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.put.mutationOptions()
    await mutationOptions.onSuccess?.(
      composerState,
      {
        params: {
          snippet_id: 'snippet-1',
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
        consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
          {
            input: {
              params: {
                snippet_id: 'snippet-1',
                node_id: 'node-1',
              },
            },
          },
        ),
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

  it('should cache snippet composer state and invalidate roster lists after saving inline agent to roster', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const composerState = createWorkflowComposerState()

    const mutationOptions =
      consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      composerState,
      {
        params: {
          snippet_id: 'snippet-1',
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
        consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
          {
            input: {
              params: {
                snippet_id: 'snippet-1',
                node_id: 'node-1',
              },
            },
          },
        ),
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
    const composerQueryKey = consoleQuery.agent.byAgentId.composer.get.queryKey({
      input: {
        params: {
          agent_id: 'agent-1',
        },
      },
    })
    queryClient.setQueryData(
      composerQueryKey,
      createComposerState({
        active_config_snapshot: {
          id: 'snapshot-previous',
          version: 1,
        },
        agent_soul: {
          config_note: 'Keep the cached composer state',
          schema_version: 1,
        },
      }),
    )
    const publishResponse = createAgentPublishResponse({
      active_config_snapshot: {
        id: 'snapshot-2',
        version: 2,
      },
      active_config_snapshot_id: 'snapshot-2',
      draft: {
        agent_id: 'agent-1',
        draft_type: 'draft',
        id: 'draft-1',
        updated_at: 1710000300,
      },
    })

    const mutationOptions = consoleQuery.agent.byAgentId.publish.post.mutationOptions()
    await mutationOptions.onSuccess?.(
      publishResponse,
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
    expect(queryClient.getQueryData(composerQueryKey)).toEqual(
      expect.objectContaining({
        active_config_is_published: true,
        active_config_snapshot: publishResponse.active_config_snapshot,
        agent_soul: {
          config_note: 'Keep the cached composer state',
          schema_version: 1,
        },
        draft: publishResponse.draft,
      }),
    )
  })

  it('should invalidate roster list but keep invite options stable after saving an agent draft', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const composerQueryKey = consoleQuery.agent.byAgentId.composer.get.queryKey({
      input: {
        params: {
          agent_id: 'agent-1',
        },
      },
    })
    const savedComposerState = createComposerState({
      agent_soul: {
        config_note: 'Saved composer state',
        schema_version: 1,
      },
    })

    const mutationOptions = consoleQuery.agent.byAgentId.composer.put.mutationOptions()
    await mutationOptions.onSuccess?.(
      savedComposerState,
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
    expect(queryClient.getQueryData(composerQueryKey)).toEqual(savedComposerState)
  })

  it('should clear deleted agent queries and invalidate invite option lists', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const deletedAgent = createAgent()
    const otherAgent = createAgent({ id: 'agent-2' })
    const deletedAgentDetailQueryKey = consoleQuery.agent.byAgentId.get.queryKey({
      input: {
        params: {
          agent_id: deletedAgent.id,
        },
      },
    })
    const deletedAgentComposerQueryKey = consoleQuery.agent.byAgentId.composer.get.queryKey({
      input: {
        params: {
          agent_id: deletedAgent.id,
        },
      },
    })
    const otherAgentDetailQueryKey = consoleQuery.agent.byAgentId.get.queryKey({
      input: {
        params: {
          agent_id: otherAgent.id,
        },
      },
    })
    queryClient.setQueryData(deletedAgentDetailQueryKey, deletedAgent)
    queryClient.setQueryData(deletedAgentComposerQueryKey, createComposerState())
    queryClient.setQueryData(otherAgentDetailQueryKey, otherAgent)

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
    expect(queryClient.getQueryData(deletedAgentDetailQueryKey)).toBeUndefined()
    expect(queryClient.getQueryData(deletedAgentComposerQueryKey)).toBeUndefined()
    expect(queryClient.getQueryData(otherAgentDetailQueryKey)).toEqual(otherAgent)
  })
})

// Scenario: oRPC mutation defaults own shared Web app access cache behavior.
describe('consoleQuery Web app access mutation defaults', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should invalidate access data and Agent details after updating Web app access', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const mutationOptions =
      consoleQuery.enterprise.webAppAuth.updateWebAppWhitelistSubjects.mutationOptions()
    await mutationOptions.onSuccess?.(
      { message: 'updated' },
      {
        body: {
          appId: 'app-1',
          accessMode: 'private',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.agent.byAgentId.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.starred.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.recent.get.key(),
    })
  })
})

describe('consoleQuery App Deploy cache behavior', () => {
  it.each([
    ['api', 'active'],
    ['site', 'active'],
    ['api', 'reopened'],
    ['site', 'reopened'],
  ] as const)(
    'keeps the saved %s switch in %s deployment reads when refreshing fails',
    async (accessPoint, view) => {
      const consoleQuery = await loadConsoleQuery()
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      const params = { app_id: 'app-1', environment_id: 'staging' }
      const staging = {
        environment: {
          id: 'staging',
          display_name: 'Staging',
          description: '',
          status: 'ENVIRONMENT_STATUS_READY' as const,
        },
        access: { enable_api: true, enable_site: true },
      }
      const production = { ...staging, environment: { ...staging.environment, id: 'production' } }
      const deployments = consoleQuery.enterprise.appDeploy.deploymentService
      const list = deployments.listEnvironmentDeployments.queryOptions({
        input: { params: { app_id: params.app_id } },
        queryFn: async () => {
          throw new Error('Deployment list unavailable')
        },
      })
      const detail = deployments.getEnvironmentDeployment.queryOptions({
        input: { params },
        queryFn: async () => {
          throw new Error('Deployment detail unavailable')
        },
      })
      const otherApp = deployments.listEnvironmentDeployments.queryOptions({
        input: { params: { app_id: 'app-2' } },
      })
      const otherEnvironment = deployments.getEnvironmentDeployment.queryOptions({
        input: { params: { ...params, environment_id: 'production' } },
      })
      client.setQueryData(list.queryKey, { environment_deployments: [staging, production] })
      client.setQueryData(detail.queryKey, { environment_deployment: staging })
      client.setQueryData(otherApp.queryKey, { environment_deployments: [staging] })
      client.setQueryData(otherEnvironment.queryKey, { environment_deployment: production })
      const listObserver = new QueryObserver(client, list)
      const detailObserver = new QueryObserver(client, detail)
      const unsubscribe =
        view === 'active'
          ? [listObserver.subscribe(() => {}), detailObserver.subscribe(() => {})]
          : []

      try {
        const access = consoleQuery.enterprise.appDeploy.accessService
        if (accessPoint === 'api') {
          const saved = { enabled: false, base_url: 'https://api.example.com/v1', api_key_count: 1 }
          await new MutationObserver(
            client,
            access.updateEnvironmentApi.mutationOptions({
              mutationFn: async () => saved,
            }),
          ).mutate({ params, body: { enabled: false } })
          expect(
            client.getQueryData(
              access.getEnvironmentApi.queryOptions({ input: { params } }).queryKey,
            ),
          ).toEqual(saved)
        } else {
          const saved = {
            enabled: false,
            code: 'site-1',
            app_base_url: 'https://app.example.com',
            access_mode: 'public',
          }
          await new MutationObserver(
            client,
            access.updateEnvironmentSite.mutationOptions({
              mutationFn: async () => saved,
            }),
          ).mutate({ params, body: { enabled: false } })
          expect(
            client.getQueryData(
              access.getEnvironmentSite.queryOptions({ input: { params } }).queryKey,
            ),
          ).toEqual(saved)
        }

        if (view === 'reopened') {
          unsubscribe.push(
            listObserver.subscribe(() => {}),
            detailObserver.subscribe(() => {}),
          )
          await Promise.all([
            listObserver.refetch({ cancelRefetch: false }),
            detailObserver.refetch({ cancelRefetch: false }),
          ])
        }

        const savedDeployment = {
          ...staging,
          access: { enable_api: accessPoint !== 'api', enable_site: accessPoint !== 'site' },
        }
        expect(listObserver.getCurrentResult()).toMatchObject({
          isRefetchError: true,
          data: { environment_deployments: [savedDeployment, production] },
        })
        expect(detailObserver.getCurrentResult()).toMatchObject({
          isRefetchError: true,
          data: { environment_deployment: savedDeployment },
        })
        expect(client.getQueryData(otherApp.queryKey)).toEqual({
          environment_deployments: [staging],
        })
        expect(client.getQueryData(otherEnvironment.queryKey)).toEqual({
          environment_deployment: production,
        })
      } finally {
        unsubscribe.forEach((stop) => stop())
        client.clear()
      }
    },
  )

  it.each(['create', 'delete'] as const)(
    'refreshes environment keys and their count after %s',
    async (action) => {
      const consoleQuery = await loadConsoleQuery()
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
      const params = { app_id: 'app-1', environment_id: 'staging' }
      const key = { created_at: 1, id: 'key-1', token: 'secret', type: 'api' }
      let keys = action === 'create' ? [] : [key]
      const list = {
        ...consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryOptions({
          input: { params },
        }),
        queryFn: async () => ({ data: keys }),
      }
      const summary = {
        ...consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
          input: { params },
        }),
        queryFn: async () => ({
          enabled: true,
          base_url: 'https://api.example.com/v1',
          api_key_count: keys.length,
        }),
      }
      await Promise.all([client.query(list), client.query(summary)])

      if (action === 'create') {
        const mutation = new MutationObserver(client, {
          ...consoleQuery.enterprise.appDeploy.accessService.createEnvironmentApiKey.mutationOptions(),
          mutationFn: async () => {
            keys = [key]
            return key
          },
        })
        await mutation.mutate({ params })
      } else {
        const mutation = new MutationObserver(client, {
          ...consoleQuery.enterprise.appDeploy.accessService.deleteEnvironmentApiKey.mutationOptions(),
          mutationFn: async () => {
            keys = []
            return {}
          },
        })
        await mutation.mutate({ params: { ...params, api_key_id: key.id } })
      }

      expect((await client.query(list)).data).toEqual(keys)
      expect((await client.query(summary)).api_key_count).toBe(keys.length)
    },
  )

  it.each(['deploy', 'undeploy'] as const)(
    'refreshes deployment reads after %s',
    async (action) => {
      const consoleQuery = await loadConsoleQuery()
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
      const params = { app_id: 'app-1', environment_id: 'staging', workflow_id: 'workflow-1' }
      const environment = {
        id: 'staging',
        display_name: 'Staging',
        description: '',
        status: 'ENVIRONMENT_STATUS_READY' as const,
      }
      const deployment = { environment, access: { enable_api: true, enable_site: true } }
      const readList = vi.fn(async () => ({ environment_deployments: [deployment] }))
      const readDetail = vi.fn(async () => ({ environment_deployment: deployment }))
      const readEnvironments = vi.fn(async () => ({ data: [environment] }))
      const list = {
        ...consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
          { input: { params: { app_id: params.app_id } } },
        ),
        queryFn: readList,
      }
      const detail = {
        ...consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions(
          { input: { params: { app_id: params.app_id, environment_id: params.environment_id } } },
        ),
        queryFn: readDetail,
      }
      const environments = {
        ...consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
          input: { params: { app_id: params.app_id } },
        }),
        queryFn: readEnvironments,
      }
      await Promise.all([client.query(list), client.query(detail), client.query(environments)])
      const response = {
        operation: {
          id: 'operation-1',
          status: 'DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS' as const,
          type: 'DEPLOYMENT_OPERATION_TYPE_DEPLOY' as const,
        },
      }

      if (action === 'deploy') {
        await new MutationObserver(client, {
          ...consoleQuery.enterprise.appDeploy.deploymentService.deployWorkflow.mutationOptions(),
          mutationFn: async () => response,
        }).mutate({ params, body: { environment_variable_groups: [] } })
      } else {
        await new MutationObserver(client, {
          ...consoleQuery.enterprise.appDeploy.deploymentService.undeployWorkflow.mutationOptions(),
          mutationFn: async () => ({
            operation: {
              ...response.operation,
              type: 'DEPLOYMENT_OPERATION_TYPE_UNDEPLOY' as const,
            },
          }),
        }).mutate({ params })
      }

      await Promise.all([client.query(list), client.query(detail), client.query(environments)])
      expect(readList).toHaveBeenCalledTimes(2)
      expect(readDetail).toHaveBeenCalledTimes(2)
      expect(readEnvironments).toHaveBeenCalledTimes(action === 'undeploy' ? 2 : 1)
    },
  )
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
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
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
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.starred.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.recent.get.key(),
    })
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
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
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
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.starred.get.key(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.recent.get.key(),
    })
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
