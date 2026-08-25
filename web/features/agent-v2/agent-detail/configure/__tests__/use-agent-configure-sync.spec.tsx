import type { PropsWithChildren } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { Suspense } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import {
  agentComposerDraftAtom,
  agentComposerSavedDraftAtom,
} from '@/features/agent-v2/agent-composer/store'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { agentComposerSkillsAtom } from '@/features/agent-v2/agent-composer/store-modules/skills'
import { useAgentConfigureSync } from '../use-agent-configure-sync'

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

const trackEventMock = vi.hoisted(() => vi.fn())

const toolProviderState = vi.hoisted(() => ({
  builtInTools: [] as ToolWithProvider[] | undefined,
  customTools: [] as ToolWithProvider[] | undefined,
  mcpTools: [] as ToolWithProvider[] | undefined,
  workflowTools: [] as ToolWithProvider[] | undefined,
}))

const marketplacePluginState = vi.hoisted(() => ({
  label: undefined as Record<string, string> | undefined,
}))

const composerPutMutationFn = vi.hoisted(() =>
  vi.fn(
    async (variables: {
      body: {
        agent_soul: Record<string, unknown>
      }
    }) => ({
      agent_soul: variables.body.agent_soul,
    }),
  ),
)

const composerPutRequestContexts = vi.hoisted(
  () => [] as Array<{ keepalive?: boolean; silent?: boolean } | undefined>,
)

const composerPutMutationOptions = vi.hoisted(() =>
  vi.fn(
    (options?: {
      context?: {
        keepalive?: boolean
        silent?: boolean
      }
      onSuccess?: (
        data: { agent_soul: Record<string, unknown> },
        variables: {
          params: { agent_id: string }
          body: {
            agent_soul: Record<string, unknown>
          }
        },
      ) => void
    }) => ({
      mutationFn: async (variables: {
        params: { agent_id: string }
        body: {
          agent_soul: Record<string, unknown>
        }
      }) => {
        composerPutRequestContexts.push(options?.context)
        const data = await composerPutMutationFn(variables)
        options?.onSuccess?.(data, variables)
        return data
      },
    }),
  ),
)

type PublishAgentVariables = {
  params: { agent_id: string }
  body: Record<string, never>
}

type PublishAgentResponse = {
  active_config_snapshot: Record<string, unknown> | null
  active_config_snapshot_id: string
  result: string
}

const publishAgentMutationFn = vi.hoisted(() =>
  vi.fn(async (_variables: PublishAgentVariables): Promise<PublishAgentResponse> => ({
    active_config_snapshot: {
      id: 'snapshot-1',
    },
    active_config_snapshot_id: 'snapshot-1',
    result: 'success',
  })),
)

const publishAgentMutationOptions = vi.hoisted(() =>
  vi.fn(
    (options?: {
      context?: {
        silent?: boolean
      }
      onSuccess?: (data: PublishAgentResponse, variables: PublishAgentVariables) => void
    }) => ({
      mutationFn: async (variables: PublishAgentVariables) => {
        const data = await publishAgentMutationFn(variables)
        options?.onSuccess?.(data, variables)
        return data
      },
    }),
  ),
)

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function setDocumentVisibilityState(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  })
}

const configuredModel = {
  provider: 'langgenius/openai/openai',
  model: 'gpt-4o-mini',
}

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: trackEventMock,
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByInfo: (infos: Array<{ organization: string; plugin: string }>) => ({
    data:
      infos.length > 0 && marketplacePluginState.label
        ? {
            data: {
              list: infos.map(({ organization, plugin }) => ({
                plugin: {
                  label: marketplacePluginState.label,
                  labels: marketplacePluginState.label,
                  name: plugin,
                  plugin_id: `${organization}/${plugin}`,
                },
              })),
            },
          }
        : undefined,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: toolProviderState.builtInTools }),
  useAllCustomTools: () => ({ data: toolProviderState.customTools }),
  useAllMCPTools: () => ({ data: toolProviderState.mcpTools }),
  useAllWorkflowTools: () => ({ data: toolProviderState.workflowTools }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      get: {
        key: () => ['agents'],
      },
      byAgentId: {
        get: {
          queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
            'agent-detail',
            input.params.agent_id,
          ],
        },
        apiAccess: {
          get: {
            queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
              'agent-api-access',
              input.params.agent_id,
            ],
          },
        },
        composer: {
          get: {
            queryKey: ({ input }: { input: { params: { agent_id: string } } }) => [
              'agent-composer',
              input.params.agent_id,
            ],
          },
          put: {
            mutationOptions: composerPutMutationOptions,
          },
        },
        publish: {
          post: {
            mutationOptions: publishAgentMutationOptions,
          },
        },
        versions: {
          get: {
            key: () => ['agent-versions'],
          },
        },
      },
    },
  },
}))

function renderUseAgentConfigureSync({
  agentName = 'Agent',
  baseConfig,
  currentModel,
  enabled = true,
  suspend = false,
}: {
  agentName?: Parameters<typeof useAgentConfigureSync>[0]['agentName']
  baseConfig?: Parameters<typeof useAgentConfigureSync>[0]['baseConfig']
  currentModel?: Parameters<typeof useAgentConfigureSync>[0]['currentModel']
  enabled?: boolean
  suspend?: boolean
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const store = createStore()
  const pendingRender = new Promise<void>(() => {})
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <Suspense fallback={null}>{children}</Suspense>
      </JotaiProvider>
    </QueryClientProvider>
  )

  return {
    ...renderHook(
      (props) => {
        const sync = useAgentConfigureSync({
          agentId: 'agent-1',
          agentName: props.agentName,
          baseConfig: props.baseConfig,
          currentModel: props.currentModel,
          enabled: props.enabled,
        })
        if (props.suspend) throw pendingRender

        return sync
      },
      {
        initialProps: {
          agentName,
          baseConfig,
          currentModel,
          enabled,
          suspend,
        },
        wrapper,
      },
    ),
    queryClient,
    store,
  }
}

const credentialRequiredProvider = {
  id: 'google',
  name: 'google',
  author: 'Google',
  description: {
    en_US: 'Google tools.',
    zh_Hans: 'Google 工具。',
  },
  icon: 'https://example.com/google.svg',
  icon_dark: 'https://example.com/google-dark.svg',
  label: {
    en_US: 'Google Tools',
    zh_Hans: 'Google 工具',
  },
  type: CollectionType.builtIn,
  team_credentials: {
    api_key: {
      label: {
        en_US: 'API Key',
        zh_Hans: 'API Key',
      },
      placeholder: {
        en_US: 'Enter API key',
        zh_Hans: '输入 API Key',
      },
      required: true,
      type: 'secret-input',
      variable: 'api_key',
    },
  },
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  meta: {
    version: '0.0.1',
  },
  tools: [],
} satisfies ToolWithProvider

describe('useAgentConfigureSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    composerPutRequestContexts.length = 0
    toolProviderState.builtInTools = []
    toolProviderState.customTools = []
    toolProviderState.mcpTools = []
    toolProviderState.workflowTools = []
    marketplacePluginState.label = undefined
  })

  afterEach(() => {
    setDocumentVisibilityState('visible')
    vi.useRealTimers()
  })

  it('should automatically save configure page changes to draft', async () => {
    const { queryClient, store } = renderUseAgentConfigureSync()
    queryClient.setQueryData(['agent-detail', 'agent-1'], {
      active_config_is_published: true,
      name: 'Agent',
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft only prompt',
      })
    })

    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
    expect(composerPutMutationFn).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent_id: 'agent-1',
        },
        body: expect.objectContaining({
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Draft only prompt',
            }),
          }),
        }),
      }),
    )
    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
  })

  it('should autosave only the latest committed Agent configuration', async () => {
    const committedProps = {
      agentName: 'Agent',
      baseConfig: {
        app_features: {
          file_upload: {
            enabled: true,
          },
        },
      },
      currentModel: configuredModel,
      enabled: true,
      suspend: false,
    }
    const nextProps = {
      agentName: 'Agent',
      baseConfig: {
        app_features: {
          file_upload: {
            enabled: false,
          },
        },
      },
      currentModel: {
        provider: 'langgenius/anthropic/anthropic',
        model: 'claude-3-5-sonnet',
      },
      enabled: true,
      suspend: true,
    }
    const { rerender, store } = renderUseAgentConfigureSync(committedProps)

    rerender(nextProps)
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft while the next configuration is pending',
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            app_features: expect.objectContaining({
              file_upload: expect.objectContaining({ enabled: true }),
            }),
            model: expect.objectContaining({
              model: 'gpt-4o-mini',
              model_provider: 'langgenius/openai/openai',
            }),
          }),
        }),
      }),
    )

    rerender({ ...nextProps, suspend: false })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft after the next configuration commits',
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            app_features: expect.objectContaining({
              file_upload: expect.objectContaining({ enabled: false }),
            }),
            model: expect.objectContaining({
              model: 'claude-3-5-sonnet',
              model_provider: 'langgenius/anthropic/anthropic',
            }),
          }),
        }),
      }),
    )
  })

  it('should cancel pending autosave when the draft returns to the saved baseline', async () => {
    const { queryClient, store } = renderUseAgentConfigureSync()
    queryClient.setQueryData(['agent-detail', 'agent-1'], {
      active_config_is_published: true,
      name: 'Agent',
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Temporary prompt',
      })
    })
    act(() => {
      store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
  })

  it('should save dirty draft once when the page is closing', async () => {
    const saveDeferred = createDeferredPromise<{ agent_soul: Record<string, unknown> }>()
    composerPutMutationFn.mockReturnValueOnce(saveDeferred.promise)
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Closing prompt',
      })
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()

    await act(async () => {
      setDocumentVisibilityState('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(composerPutRequestContexts).toEqual([{ keepalive: true, silent: true }])
    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent_id: 'agent-1',
        },
        body: expect.objectContaining({
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Closing prompt',
            }),
          }),
        }),
      }),
    )

    await act(async () => {
      saveDeferred.resolve({ agent_soul: {} })
      await Promise.resolve()
    })
  })

  it('should keep page-close saving enabled until a disabled configuration commits', async () => {
    const committedProps = {
      agentName: 'Agent',
      baseConfig: undefined,
      currentModel: configuredModel,
      enabled: true,
      suspend: false,
    }
    const disabledProps = {
      ...committedProps,
      enabled: false,
      suspend: true,
    }
    const { rerender, store } = renderUseAgentConfigureSync(committedProps)

    rerender(disabledProps)
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Committed draft before closing',
      })
    })
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Committed draft before closing',
            }),
          }),
        }),
      }),
    )

    rerender({ ...disabledProps, suspend: false })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Disabled draft after commit',
      })
    })
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
  })

  it('should dispatch the latest keepalive save while an earlier save is pending', async () => {
    const saveDeferred = createDeferredPromise<{ agent_soul: Record<string, unknown> }>()
    composerPutMutationFn.mockReturnValueOnce(saveDeferred.promise)
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Explicit save prompt',
      })
    })

    let saveDraftPromise!: Promise<void>
    act(() => {
      saveDraftPromise = result.current.saveDraft()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Latest closing prompt',
      })
    })
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(2)
    expect(composerPutRequestContexts).toEqual([
      { silent: true },
      { keepalive: true, silent: true },
    ])
    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Latest closing prompt',
            }),
          }),
        }),
      }),
    )

    await act(async () => {
      saveDeferred.resolve({ agent_soul: {} })
      await saveDraftPromise
      await Promise.resolve()
    })
    expect(store.get(agentComposerSavedDraftAtom)?.prompt).toBe('Latest closing prompt')
  })

  it('should repeat an in-flight explicit save with keepalive before unload', async () => {
    const saveDeferred = createDeferredPromise<{ agent_soul: Record<string, unknown> }>()
    composerPutMutationFn.mockReturnValueOnce(saveDeferred.promise)
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Pending explicit save',
      })
    })

    let saveDraftPromise!: Promise<void>
    act(() => {
      saveDraftPromise = result.current.saveDraft()
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(2)
    expect(composerPutRequestContexts).toEqual([
      { silent: true },
      { keepalive: true, silent: true },
    ])

    await act(async () => {
      saveDeferred.resolve({ agent_soul: {} })
      await saveDraftPromise
      await Promise.resolve()
    })
  })

  it('should save the latest dirty draft when Configure unmounts before autosave runs', async () => {
    const { store, unmount } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Route leave prompt',
      })
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()

    await act(async () => {
      unmount()
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent_id: 'agent-1',
        },
        body: expect.objectContaining({
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Route leave prompt',
            }),
          }),
        }),
      }),
    )
  })

  it('should not save the same draft again when Configure unmounts during an explicit save', async () => {
    const saveDeferred = createDeferredPromise<{ agent_soul: Record<string, unknown> }>()
    composerPutMutationFn.mockReturnValueOnce(saveDeferred.promise)
    const { result, store, unmount } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Switching prompt',
      })
    })

    let saveDraftPromise!: Promise<void>
    act(() => {
      saveDraftPromise = result.current.saveDraft()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      saveDeferred.resolve({ agent_soul: {} })
      await saveDraftPromise
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
  })

  it('should include Agent Soul files when autosaving file changes', async () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        files: [
          {
            id: 'uploaded.md',
            name: 'uploaded.md',
            icon: 'markdown',
            fileId: 'drive-file-1',
            configName: 'uploaded.md',
          },
        ],
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            config_files: [
              {
                file_id: 'drive-file-1',
                file_kind: 'upload_file',
                name: 'uploaded.md',
              },
            ],
            config_skills: [],
          }),
        }),
      }),
    )
  })

  it('should preserve uploaded skills when prompt is updated immediately after upload', async () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerSkillsAtom, [
        {
          id: 'Tender Analyzer',
          name: 'Tender Analyzer',
          description: 'Extracts tender requirements.',
          fileId: 'tool-file-1',
          hash: 'sha256:skill-1',
          mimeType: 'application/zip',
          size: 42,
        },
      ])
      store.set(agentComposerPromptAtom, 'Use [§skill:Tender Analyzer:Tender Analyzer§]')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Use [§skill:Tender Analyzer:Tender Analyzer§]',
            }),
            config_skills: [
              {
                description: 'Extracts tender requirements.',
                file_id: 'tool-file-1',
                file_kind: 'tool_file',
                hash: 'sha256:skill-1',
                mime_type: 'application/zip',
                name: 'Tender Analyzer',
                size: 42,
              },
            ],
            config_files: [],
          }),
        }),
      }),
    )
  })

  it('should preserve uploaded files when prompt is updated immediately after upload', async () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerFilesAtom, [
        {
          id: 'uploaded.md',
          name: 'uploaded.md',
          icon: 'markdown',
          fileId: 'drive-file-1',
          configName: 'uploaded.md',
          hash: 'sha256:file-1',
          mimeType: 'text/markdown',
          size: 5,
        },
      ])
      store.set(agentComposerPromptAtom, 'Use [§file:uploaded.md:uploaded.md§]')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Use [§file:uploaded.md:uploaded.md§]',
            }),
            config_files: [
              {
                file_id: 'drive-file-1',
                file_kind: 'upload_file',
                hash: 'sha256:file-1',
                mime_type: 'text/markdown',
                name: 'uploaded.md',
                size: 5,
              },
            ],
            config_skills: [],
          }),
        }),
      }),
    )
  })

  it('should autosave when knowledge retrieval validation fails', async () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasetRefs: [],
          },
        ],
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
  })

  it('should keep autosave failures silent and leave the local draft dirty', async () => {
    composerPutMutationFn.mockRejectedValueOnce(new Error('save failed'))
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Unsaved autosave prompt',
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(store.get(agentComposerDraftAtom).prompt).toBe('Unsaved autosave prompt')
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(composerPutRequestContexts).toEqual([{ silent: true }])
  })

  it('should save the latest draft immediately when requested', async () => {
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Run prompt',
      })
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent_id: 'agent-1',
        },
        body: expect.objectContaining({
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Run prompt',
            }),
          }),
        }),
      }),
    )
  })

  it('should reject explicit save requests when the draft cannot be saved', async () => {
    composerPutMutationFn.mockRejectedValueOnce(new Error('save failed'))
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Run prompt',
      })
    })

    await expect(result.current.saveDraft()).rejects.toThrow('Failed to save agent composer draft.')
    expect(store.get(agentComposerDraftAtom).prompt).toBe('Run prompt')
    expect(toastMock.error).toHaveBeenCalledWith('common.api.actionFailed')
  })

  it('should not save the draft immediately when the composer draft is unchanged', async () => {
    const { queryClient, result } = renderUseAgentConfigureSync()
    queryClient.setQueryData(['agent-detail', 'agent-1'], {
      active_config_is_published: true,
      name: 'Agent',
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
  })

  it('should save the effective model before run when the form draft is unchanged', async () => {
    const { result } = renderUseAgentConfigureSync({
      baseConfig: {
        schema_version: 1,
        prompt: {
          system_prompt: '',
        },
      },
      currentModel: {
        provider: 'langgenius/openai/openai',
        model: 'gpt-4o-mini',
      },
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
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

  it('should save draft manually when knowledge retrieval validation fails', async () => {
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasetRefs: [],
          },
        ],
      })
    })

    await act(async () => {
      await result.current.saveDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
  })

  it('should publish only when publishDraft is called explicitly', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Published prompt',
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          agent_id: 'agent-1',
        },
        body: expect.objectContaining({
          variant: 'agent_app',
          save_strategy: 'save_to_current_version',
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Published prompt',
            }),
          }),
        }),
      }),
    )
    expect(publishAgentMutationFn).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {},
    })
    expect(trackEventMock).toHaveBeenCalledWith('app_published_time', {
      action_mode: 'app',
      app_id: 'agent-1',
      app_name: 'Agent',
      app_mode: 'agent-v2',
    })
    expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess')
  })

  it('should toast and skip publish when no model is configured', async () => {
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Published prompt',
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('common.modelProvider.selectModel')
  })

  it('should toast and skip publish when a configured tool is not installed', async () => {
    marketplacePluginState.label = {
      en_US: 'Jina',
    }
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        tools: [
          {
            id: 'langgenius/jina_tool/jina',
            kind: 'provider',
            name: 'langgenius/jina_tool/jina',
            iconClassName: 'i-custom-public-other-default-tool-icon',
            providerType: 'plugin',
            credentialType: 'unauthorized',
            credentialVariant: 'unauthorized',
            actions: [],
          },
        ],
      } satisfies AgentSoulConfigFormState)
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(
      'workflow.nodes.agent.toolNotInstallTooltip:{"tool":"Jina"}',
    )
  })

  it('should toast and skip publish when a configured tool is not authorized', async () => {
    toolProviderState.builtInTools = [credentialRequiredProvider]
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        tools: [
          {
            id: 'google',
            kind: 'provider',
            name: 'google',
            displayName: 'Google Tools',
            iconClassName: 'i-custom-public-other-default-tool-icon',
            providerType: 'builtin',
            credentialType: 'unauthorized',
            credentialVariant: 'unauthorized',
            actions: [],
          },
        ],
      } satisfies AgentSoulConfigFormState)
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(
      'workflow.nodes.agent.toolNotAuthorizedTooltip:{"tool":"Google Tools"}',
    )
  })

  it('should keep default model fallback from leaving the local draft dirty after publish', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Published prompt',
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(publishAgentMutationFn).toHaveBeenCalledTimes(1)
    const savedDraft = store.get(agentComposerSavedDraftAtom)
    expect(store.get(agentComposerDraftAtom).model).toBeUndefined()
    expect(savedDraft?.model).toBeUndefined()
    expect(savedDraft).toEqual(store.get(agentComposerDraftAtom))
  })

  it('should keep base config fallback fields from leaving the local draft dirty after publish', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
      baseConfig: {
        app_features: {
          file_upload: {
            enabled: true,
          },
        },
      },
    })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Published prompt',
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(publishAgentMutationFn).toHaveBeenCalledTimes(1)
    const savedDraft = store.get(agentComposerSavedDraftAtom)
    expect(store.get(agentComposerDraftAtom).appFeatures).toBeUndefined()
    expect(savedDraft?.appFeatures).toBeUndefined()
    expect(savedDraft).toEqual(store.get(agentComposerDraftAtom))
  })

  it('should publish the current draft snapshot instead of a stale caller payload', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Current draft prompt',
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          save_strategy: 'save_to_current_version',
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Current draft prompt',
            }),
          }),
        }),
      }),
    )
    expect(publishAgentMutationFn).toHaveBeenCalledTimes(1)
  })

  it('should reject publish and keep the publish mutation untouched when saving the draft fails', async () => {
    composerPutMutationFn.mockRejectedValueOnce(new Error('save failed'))
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Unpublished prompt',
      })
    })

    await expect(result.current.publishDraft()).rejects.toThrow('save failed')

    expect(publishAgentMutationFn).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith('save failed')
  })

  it('should show the API error message when publishing fails', async () => {
    const responseError = new Response(
      JSON.stringify({
        code: 'invalid_model_credentials',
        message: 'Model credential validation failed',
        status: 400,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 400,
        statusText: 'Bad Request',
      },
    )
    publishAgentMutationFn.mockRejectedValueOnce(responseError)
    const { result } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    await expect(result.current.publishDraft()).rejects.toBe(responseError)

    expect(toastMock.error).toHaveBeenCalledWith('Model credential validation failed')
  })

  it('should show the default error when publish rejection has no message', async () => {
    publishAgentMutationFn.mockRejectedValueOnce({ code: 'publish_failed' })
    const { result } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    await expect(result.current.publishDraft()).rejects.toEqual({ code: 'publish_failed' })

    expect(toastMock.error).toHaveBeenCalledWith('common.api.actionFailed')
  })

  it('should skip publish while the Composer Query is unavailable', async () => {
    const { result } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
      enabled: false,
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
  })

  it('should toast and skip publish when knowledge retrieval validation fails', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasetRefs: [],
          },
        ],
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(
      'common.errorMsg.fieldRequired:{"field":"agentV2.agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label"}',
    )
  })

  it('should toast metadata filtering model error when publishing with automatic metadata filtering and no model', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
            metadataFilterMode: MetadataFilteringModeEnum.automatic,
          },
        ],
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledWith(
      'agentV2.agentDetail.configure.knowledgeRetrieval.validation.metadataModelRequired',
    )
  })

  it('should expose publishing status from the publish mutation while publish is pending', async () => {
    const publishDeferred = createDeferredPromise<PublishAgentResponse>()
    publishAgentMutationFn.mockReturnValueOnce(publishDeferred.promise)
    const { result } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })
    let publishPromise!: Promise<void>
    act(() => {
      publishPromise = result.current.publishDraft()
    })

    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isPublishing).toBe(true)

    await act(async () => {
      publishDeferred.resolve({
        active_config_snapshot: {},
        active_config_snapshot_id: 'snapshot-1',
        result: 'success',
      })
      await publishPromise
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isPublishing).toBe(false)
  })

  it('should pause autosave during publish and resume it for edits made in flight', async () => {
    const publishDeferred = createDeferredPromise<PublishAgentResponse>()
    publishAgentMutationFn.mockReturnValueOnce(publishDeferred.promise)
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft captured for publish',
      })
    })

    let publishPromise!: Promise<void>
    act(() => {
      publishPromise = result.current.publishDraft()
    })
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)
    expect(publishAgentMutationFn).toHaveBeenCalledTimes(1)

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Edited while publish is pending',
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(composerPutMutationFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      publishDeferred.resolve({
        active_config_snapshot: {},
        active_config_snapshot_id: 'snapshot-1',
        result: 'success',
      })
      await publishPromise
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(2)
    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Edited while publish is pending',
            }),
          }),
        }),
      }),
    )
  })

  it('should dispatch a keepalive save for edits made while publish is pending', async () => {
    const publishDeferred = createDeferredPromise<PublishAgentResponse>()
    publishAgentMutationFn.mockReturnValueOnce(publishDeferred.promise)
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft captured for publish',
      })
    })

    let publishPromise!: Promise<void>
    act(() => {
      publishPromise = result.current.publishDraft()
    })
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(publishAgentMutationFn).toHaveBeenCalledTimes(1)

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Latest edit before closing',
      })
    })
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'))
      await Promise.resolve()
    })

    expect(composerPutMutationFn).toHaveBeenCalledTimes(2)
    expect(composerPutRequestContexts).toEqual([
      { silent: true },
      { keepalive: true, silent: true },
    ])
    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Latest edit before closing',
            }),
          }),
        }),
      }),
    )

    await act(async () => {
      publishDeferred.resolve({
        active_config_snapshot: {},
        active_config_snapshot_id: 'snapshot-1',
        result: 'success',
      })
      await publishPromise
      await Promise.resolve()
    })
  })

  it('should resume autosave for edits made while publish fails', async () => {
    const publishDeferred = createDeferredPromise<PublishAgentResponse>()
    publishAgentMutationFn.mockReturnValueOnce(publishDeferred.promise)
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: configuredModel,
    })
    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Draft captured for failed publish',
      })
    })

    let publishPromise!: Promise<void>
    act(() => {
      publishPromise = result.current.publishDraft()
    })
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Edited while failed publish is pending',
      })
    })
    await act(async () => {
      publishDeferred.reject(new Error('publish failed'))
      await expect(publishPromise).rejects.toThrow('publish failed')
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(result.current.isPublishing).toBe(false)
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(toastMock.error).toHaveBeenCalledWith('publish failed')
    expect(composerPutMutationFn).toHaveBeenCalledTimes(2)
    expect(composerPutMutationFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Edited while failed publish is pending',
            }),
          }),
        }),
      }),
    )
  })
})
