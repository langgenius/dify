import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { act, waitFor } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentScope } from '@/features/agent-v2/analytics'
import { consoleQuery } from '@/service/console'
import { createDefaultModelFixture } from '@/test/console/model-provider'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowInlineAgentConfigureSync } from '../agent-soul-config'
import { useCreateInlineAgentBinding, useWorkflowInlineAgentDetail } from '../hooks'

const mockDefaultModel = vi.hoisted(() => ({
  value: undefined as ReturnType<typeof createDefaultModelFixture> | undefined,
}))
const mockComposerMutationFn = vi.hoisted(() =>
  vi.fn(async (variables: unknown) => ({
    agent_soul: (
      variables as {
        body?: {
          agent_soul?: unknown
        }
      }
    ).body?.agent_soul,
    binding: {
      binding_type: 'inline_agent',
      agent_id: 'inline-agent-1',
      current_snapshot_id: 'inline-snapshot-1',
    },
    variables,
  })),
)
const mockSnippetComposerMutationFn = vi.hoisted(() =>
  vi.fn(async (variables: unknown) => ({
    agent_soul: (
      variables as {
        body?: {
          agent_soul?: unknown
        }
      }
    ).body?.agent_soul,
    binding: {
      binding_type: 'inline_agent',
      agent_id: 'snippet-inline-agent-1',
      current_snapshot_id: 'snippet-inline-snapshot-1',
    },
    variables,
  })),
)
const mockAppComposerQueryFn = vi.hoisted(() =>
  vi.fn(async (_input: unknown): Promise<{ agent?: { id: string } }> => ({
    agent: { id: 'app-agent' },
  })),
)
const mockSnippetComposerQueryFn = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({ agent: { id: 'snippet-agent' } })),
)
const trackEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/base/amplitude/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude/utils')>()),
  trackEvent: trackEventMock,
  flushEvents: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get': (input) =>
        mockAppComposerQueryFn(input),
      'snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get': (input) =>
        mockSnippetComposerQueryFn(input),
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put': (input) =>
        mockComposerMutationFn(input),
      'snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.put': (input) =>
        mockSnippetComposerMutationFn(input),
      'workspaces.current.defaultModel.get': async () =>
        mockDefaultModel.value ? { data: mockDefaultModel.value } : new Promise(() => {}),
    }),
  }
})

const appComposerKey = () =>
  consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
    input: { params: { app_id: 'app-1', node_id: 'node-1' } },
  })
const snippetComposerKey = () =>
  consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
    input: { params: { snippet_id: 'snippet-1', node_id: 'node-1' } },
  })

const createInlineAgentBindingQueryClient = (appMode: AppMode = 'workflow') => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: appMode }))
  if (mockDefaultModel.value) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: 'llm' } },
      }),
      {
        data: mockDefaultModel.value,
      },
    )
  }
  return queryClient
}

describe('useWorkflowInlineAgentDetail', () => {
  afterEach(() => vi.useRealTimers())
  it.each([
    [undefined, 'agent-1'],
    ['node-1', undefined],
  ])('does not request a composer without both node and agent IDs (%s, %s)', (nodeId, agentId) => {
    const { result } = renderWorkflowHook(() => useWorkflowInlineAgentDetail(nodeId, agentId), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockAppComposerQueryFn).not.toHaveBeenCalled()
    expect(mockSnippetComposerQueryFn).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppComposerQueryFn.mockReset()
    mockAppComposerQueryFn.mockResolvedValue({ agent: { id: 'app-agent' } })
    mockSnippetComposerQueryFn.mockReset()
    mockSnippetComposerQueryFn.mockResolvedValue({ agent: { id: 'snippet-agent' } })
  })

  it('loads inline agent detail through the snippet composer API', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () => useWorkflowInlineAgentDetail('node-1', 'snippet-agent'),
      {
        queryClient,
        resource: { kind: 'snippet', snippetId: 'snippet-1' },
      },
    )

    await waitFor(() => expect(result.current.data).toEqual({ agent: { id: 'snippet-agent' } }))
    expect(mockSnippetComposerQueryFn).toHaveBeenCalledExactlyOnceWith({
      params: { snippet_id: 'snippet-1', node_id: 'node-1' },
    })
    expect(mockAppComposerQueryFn).not.toHaveBeenCalled()
  })

  it('polls until a copied inline agent composer is created, then stops', async () => {
    vi.useFakeTimers()
    mockAppComposerQueryFn.mockResolvedValueOnce({ agent: undefined })
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () =>
        useWorkflowInlineAgentDetail('copied-node', 'source-inline-agent', {
          pollUntilReady: true,
        }),
      {
        queryClient,
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1001))
    expect(result.current.data).toEqual({ agent: { id: 'app-agent' } })
    expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(2)
  })

  it('retries five times and stops polling when loading the copied inline agent composer fails', async () => {
    vi.useFakeTimers()
    mockAppComposerQueryFn.mockRejectedValue(new Error('Agent composer was not created'))
    const queryClient = createTestQueryClient()
    queryClient.setDefaultOptions({ queries: { retry: false, retryDelay: 0 } })
    const { result } = renderWorkflowHook(
      () =>
        useWorkflowInlineAgentDetail('copied-node', 'source-inline-agent', {
          pollUntilReady: true,
        }),
      {
        queryClient,
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(result.current.isError).toBe(true)
    expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(6)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(6)
  })
})

describe('useCreateInlineAgentBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaultModel.value = createDefaultModelFixture({
      model: 'gpt-4o-mini',
      provider: { provider: 'langgenius/openai/openai' },
    })
  })

  it('creates inline agent with the default text generation model', async () => {
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.createInlineAgentBinding('node-1', { onSuccess })
    })

    await waitFor(() => expect(mockComposerMutationFn).toHaveBeenCalled())
    expect(mockComposerMutationFn).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'node_job_only',
        binding: {
          binding_type: 'inline_agent',
        },
        soul_lock: {
          locked: false,
        },
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: '',
          },
          model: {
            model_provider: 'langgenius/openai/openai',
            model: 'gpt-4o-mini',
            plugin_id: 'langgenius/openai',
          },
        },
      },
    })
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        binding_type: 'inline_agent',
        agent_id: 'inline-agent-1',
        current_snapshot_id: 'inline-snapshot-1',
      }),
    )
    expect(queryClient.getQueryData(appComposerKey())).toEqual(
      expect.objectContaining({
        agent_soul: expect.objectContaining({
          schema_version: 1,
        }),
        binding: expect.objectContaining({
          binding_type: 'inline_agent',
          agent_id: 'inline-agent-1',
          current_snapshot_id: 'inline-snapshot-1',
        }),
      }),
    )
    expect(trackEventMock).toHaveBeenCalledWith(
      'create_app',
      expect.objectContaining({
        source: 'studio_blank',
        app_mode: 'agent-v2',
        agent_scope: AgentScope.InWorkflow,
      }),
    )
  })

  it('tracks inline agent creation with the chatflow scope', async () => {
    const queryClient = createInlineAgentBindingQueryClient('advanced-chat')
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app', appId: 'chatflow-1', mode: 'advanced-chat' },
    })

    act(() => {
      void result.current.createInlineAgentBinding('node-1')
    })

    await waitFor(() => {
      expect(trackEventMock).toHaveBeenCalledWith(
        'create_app',
        expect.objectContaining({
          source: 'studio_blank',
          app_mode: 'agent-v2',
          agent_scope: AgentScope.InChatflow,
        }),
      )
    })
  })

  it('creates inline agent through the snippet composer API', async () => {
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
    })

    act(() => {
      result.current.createInlineAgentBinding('node-1', { onSuccess })
    })

    await waitFor(() => expect(mockSnippetComposerMutationFn).toHaveBeenCalled())
    expect(mockSnippetComposerMutationFn).toHaveBeenCalledWith({
      params: {
        snippet_id: 'snippet-1',
        node_id: 'node-1',
      },
      body: expect.objectContaining({
        variant: 'workflow',
        save_strategy: 'node_job_only',
        binding: {
          binding_type: 'inline_agent',
        },
      }),
    })
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        binding_type: 'inline_agent',
        agent_id: 'snippet-inline-agent-1',
        current_snapshot_id: 'snippet-inline-snapshot-1',
      }),
    )
    expect(queryClient.getQueryData(snippetComposerKey())).toEqual(
      expect.objectContaining({
        binding: expect.objectContaining({
          agent_id: 'snippet-inline-agent-1',
        }),
      }),
    )
    expect(mockComposerMutationFn).not.toHaveBeenCalled()
  })

  it('creates inline agent with a model-less initial soul before the default model loads', async () => {
    mockDefaultModel.value = undefined
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.createInlineAgentBinding('node-1', { onSuccess })
    })

    await waitFor(() => expect(mockComposerMutationFn).toHaveBeenCalled())
    expect(mockComposerMutationFn).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'node_job_only',
        binding: {
          binding_type: 'inline_agent',
        },
        soul_lock: {
          locked: false,
        },
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: '',
          },
        },
      },
    })
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        binding_type: 'inline_agent',
        agent_id: 'inline-agent-1',
        current_snapshot_id: 'inline-snapshot-1',
      }),
    )
  })

  it('reports creation failure without caching a binding or tracking a created agent', async () => {
    mockComposerMutationFn.mockRejectedValueOnce(new Error('Creation failed'))
    const queryClient = createInlineAgentBindingQueryClient()
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    await act(async () => {
      await result.current.createInlineAgentBinding('node-1', { onError, onSuccess })
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(appComposerKey())).toBeUndefined()
    expect(trackEventMock).not.toHaveBeenCalled()
    expect(result.current.isCreatingInlineAgent).toBe(false)
  })

  it('finishes inline creation after the caller component unmounts', async () => {
    let resolveComposerState!: (value: Awaited<ReturnType<typeof mockComposerMutationFn>>) => void
    mockComposerMutationFn.mockImplementationOnce(
      async (_variables) =>
        new Promise((resolve) => {
          resolveComposerState = resolve
        }),
    )
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result, unmount } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      void result.current.createInlineAgentBinding('node-1', { onSuccess })
    })
    await waitFor(() => expect(mockComposerMutationFn).toHaveBeenCalled())
    unmount()
    resolveComposerState({
      agent_soul: {
        schema_version: 1,
      },
      binding: {
        binding_type: 'inline_agent',
        agent_id: 'inline-agent-1',
        current_snapshot_id: 'inline-snapshot-1',
      },
      variables: {},
    })

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        binding_type: 'inline_agent',
        agent_id: 'inline-agent-1',
        current_snapshot_id: 'inline-snapshot-1',
      }),
    )
    expect(queryClient.getQueryData(appComposerKey())).toEqual(
      expect.objectContaining({
        agent_soul: expect.objectContaining({
          schema_version: 1,
        }),
      }),
    )
  })
})

describe('useWorkflowInlineAgentConfigureSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves inline agent composer changes through the workflow node composer API', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () => ({
        ...useWorkflowInlineAgentConfigureSync({
          nodeId: 'node-1',
          baseConfig: {
            schema_version: 1,
          },
          currentModel: {
            provider: 'langgenius/openai/openai',
            model: 'gpt-4o-mini',
          },
          enabled: true,
        }),
        setDraft: useSetAtom(agentComposerDraftAtom),
      }),
      {
        queryClient,
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    act(() => {
      result.current.setDraft({
        ...defaultAgentSoulConfigFormState,
        prompt: 'Workflow inline prompt',
      })
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(mockComposerMutationFn).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: expect.objectContaining({
        variant: 'workflow',
        save_strategy: 'node_job_only',
        agent_soul: expect.objectContaining({
          schema_version: 1,
          prompt: expect.objectContaining({
            system_prompt: 'Workflow inline prompt',
          }),
          model: expect.objectContaining({
            model_provider: 'langgenius/openai/openai',
            model: 'gpt-4o-mini',
          }),
        }),
      }),
    })
    expect(queryClient.getQueryData(appComposerKey())).toEqual(
      expect.objectContaining({
        agent_soul: expect.objectContaining({
          schema_version: 1,
        }),
      }),
    )
  })

  it('saves inline agent composer changes through the snippet composer API', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () => ({
        ...useWorkflowInlineAgentConfigureSync({
          nodeId: 'node-1',
          baseConfig: {
            schema_version: 1,
          },
          enabled: true,
        }),
        setDraft: useSetAtom(agentComposerDraftAtom),
      }),
      {
        queryClient,
        resource: { kind: 'snippet', snippetId: 'snippet-1' },
      },
    )

    act(() => {
      result.current.setDraft({
        ...defaultAgentSoulConfigFormState,
        prompt: 'Snippet inline prompt',
      })
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(mockSnippetComposerMutationFn).toHaveBeenCalledWith({
      params: {
        snippet_id: 'snippet-1',
        node_id: 'node-1',
      },
      body: expect.objectContaining({
        variant: 'workflow',
        save_strategy: 'node_job_only',
        agent_soul: expect.objectContaining({
          prompt: expect.objectContaining({
            system_prompt: 'Snippet inline prompt',
          }),
        }),
      }),
    })
    expect(queryClient.getQueryData(snippetComposerKey())).toEqual(
      expect.objectContaining({
        agent_soul: expect.objectContaining({
          schema_version: 1,
        }),
      }),
    )
    expect(mockComposerMutationFn).not.toHaveBeenCalled()
  })

  it('still saves manually when inline agent autosave is disabled', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () => ({
        ...useWorkflowInlineAgentConfigureSync({
          nodeId: 'node-1',
          baseConfig: {
            schema_version: 1,
          },
          autoSaveEnabled: false,
          enabled: true,
        }),
        setDraft: useSetAtom(agentComposerDraftAtom),
      }),
      {
        queryClient,
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    act(() => {
      result.current.setDraft({
        ...defaultAgentSoulConfigFormState,
        prompt: 'Manual inline prompt',
      })
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(mockComposerMutationFn).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'node-1',
      },
      body: expect.objectContaining({
        variant: 'workflow',
        save_strategy: 'node_job_only',
        agent_soul: expect.objectContaining({
          schema_version: 1,
          prompt: expect.objectContaining({
            system_prompt: 'Manual inline prompt',
          }),
        }),
      }),
    })
  })

  it('does not save manually when the inline agent composer draft is unchanged', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () =>
        useWorkflowInlineAgentConfigureSync({
          nodeId: 'node-1',
          baseConfig: {
            schema_version: 1,
          },
          enabled: true,
        }),
      {
        queryClient,
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(mockComposerMutationFn).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(appComposerKey())).toBeUndefined()
  })

  it('saves the effective inline model when the form draft is unchanged', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderWorkflowHook(
      () =>
        useWorkflowInlineAgentConfigureSync({
          nodeId: 'node-1',
          baseConfig: {
            schema_version: 1,
          },
          currentModel: {
            provider: 'langgenius/openai/openai',
            model: 'gpt-4o-mini',
          },
          enabled: true,
        }),
      {
        queryClient,
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(mockComposerMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            model: expect.objectContaining({
              model_provider: 'langgenius/openai/openai',
              model: 'gpt-4o-mini',
              plugin_id: 'langgenius/openai',
            }),
          }),
        }),
      }),
    )
  })
})
