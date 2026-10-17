import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { zDefaultModelResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { useSetAtom } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentScope } from '@/features/agent-v2/analytics'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { useWorkflowInlineAgentConfigureSync } from '../agent-soul-config'
import { useCreateInlineAgentBinding, useWorkflowInlineAgentDetail } from '../hooks'

const mockDefaultModel = vi.hoisted(() => ({
  value: {
    model: 'gpt-4o-mini',
    model_type: 'llm',
    provider: {
      provider: 'langgenius/openai/openai',
      icon_small: {
        en_US: 'openai',
        zh_Hans: 'openai',
      },
    },
  },
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
const trackCreateAppMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: trackCreateAppMock,
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
        data: zDefaultModelResponse.parse({
          ...mockDefaultModel.value,
          provider: {
            label: { en_US: 'OpenAI' },
            tenant_id: 'workspace-1',
            supported_model_types: ['llm'],
            ...mockDefaultModel.value.provider,
          },
        }),
      },
    )
  }
  return queryClient
}

describe('useWorkflowInlineAgentDetail', () => {
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const { result } = renderWorkflowHook(
      () => useWorkflowInlineAgentDetail('node-1', 'snippet-agent'),
      {
        queryClient,
        resource: { kind: 'snippet' as const, snippetId: 'snippet-1' },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
      },
    )

    await waitFor(() => expect(result.current.data).toEqual({ agent: { id: 'snippet-agent' } }))
    expect(mockSnippetComposerQueryFn).toHaveBeenCalledExactlyOnceWith({
      params: { snippet_id: 'snippet-1', node_id: 'node-1' },
    })
    expect(mockAppComposerQueryFn).not.toHaveBeenCalled()
  })

  it('polls until a copied inline agent composer is created for the new node', async () => {
    mockAppComposerQueryFn.mockResolvedValueOnce({ agent: undefined })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const { result } = renderWorkflowHook(
      () =>
        useWorkflowInlineAgentDetail('copied-node', 'source-inline-agent', {
          pollUntilReady: true,
        }),
      {
        queryClient,
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
      },
    )

    await waitFor(() => expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(2), {
      timeout: 1500,
    })
    expect(result.current.data).toEqual({ agent: { id: 'app-agent' } })
  })

  it('retries five times and stops polling when loading the copied inline agent composer fails', async () => {
    mockAppComposerQueryFn.mockRejectedValue(new Error('Agent composer was not created'))
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          retryDelay: 0,
        },
      },
    })
    const { result } = renderWorkflowHook(
      () =>
        useWorkflowInlineAgentDetail('copied-node', 'source-inline-agent', {
          pollUntilReady: true,
        }),
      {
        queryClient,
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
      },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
    })

    expect(mockAppComposerQueryFn).toHaveBeenCalledTimes(6)
  })
})

describe('useCreateInlineAgentBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDefaultModel.value = {
      model: 'gpt-4o-mini',
      model_type: 'llm',
      provider: {
        provider: 'langgenius/openai/openai',
        icon_small: {
          en_US: 'openai',
          zh_Hans: 'openai',
        },
      },
    }
  })

  it('creates inline agent with the default text generation model', async () => {
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
      hooksStoreProps: {
        fileSettings: {} as never,
      },
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
    expect(trackCreateAppMock).toHaveBeenCalledWith({
      source: 'studio_blank',
      appMode: 'agent-v2',
      agentScope: AgentScope.InWorkflow,
    })
  })

  it('tracks inline agent creation with the chatflow scope', async () => {
    const queryClient = createInlineAgentBindingQueryClient('advanced-chat')
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app' as const, appId: 'chatflow-1', mode: 'advanced-chat' as const },
      hooksStoreProps: {
        fileSettings: {} as never,
      },
    })

    act(() => {
      void result.current.createInlineAgentBinding('node-1')
    })

    await waitFor(() => {
      expect(trackCreateAppMock).toHaveBeenCalledWith({
        source: 'studio_blank',
        appMode: 'agent-v2',
        agentScope: AgentScope.InChatflow,
      })
    })
  })

  it('creates inline agent through the snippet composer API', async () => {
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'snippet' as const, snippetId: 'snippet-1' },
      hooksStoreProps: {
        fileSettings: {} as never,
      },
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
    mockDefaultModel.value = undefined as never
    const onSuccess = vi.fn()
    const queryClient = createInlineAgentBindingQueryClient()
    const { result } = renderWorkflowHook(() => useCreateInlineAgentBinding(), {
      queryClient,
      resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
      hooksStoreProps: {
        fileSettings: {} as never,
      },
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
    expect(trackCreateAppMock).not.toHaveBeenCalled()
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
      resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
      hooksStoreProps: {
        fileSettings: {} as never,
      },
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
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
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
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
        resource: { kind: 'snippet' as const, snippetId: 'snippet-1' },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
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
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
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
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
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
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
      },
    )

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(mockComposerMutationFn).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(appComposerKey())).toBeUndefined()
  })

  it('saves the effective inline model when the form draft is unchanged', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    })
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
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {} as never,
        },
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
