import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom, agentComposerPublishedDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { useAgentConfigureSync } from '../use-agent-configure-sync'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
}))

const composerPutMutationFn = vi.hoisted(() => vi.fn(async (variables: {
  body: {
    agent_soul: Record<string, unknown>
  }
}) => ({
  agent_soul: variables.body.agent_soul,
})))

const composerPutMutationOptions = vi.hoisted(() => vi.fn((options?: {
  onSuccess?: (data: { agent_soul: Record<string, unknown> }, variables: {
    params: { agent_id: string }
    body: {
      agent_soul: Record<string, unknown>
    }
  }) => void
}) => ({
  mutationFn: async (variables: {
    params: { agent_id: string }
    body: {
      agent_soul: Record<string, unknown>
    }
  }) => {
    const data = await composerPutMutationFn(variables)
    options?.onSuccess?.(data, variables)
    return data
  },
})))

type PublishAgentVariables = {
  params: { agent_id: string }
  body: Record<string, never>
}

type PublishAgentResponse = {
  active_config_snapshot: Record<string, unknown> | null
  active_config_snapshot_id: string
  result: string
}

const publishAgentMutationFn = vi.hoisted(() => vi.fn(async (_variables: PublishAgentVariables): Promise<PublishAgentResponse> => ({
  active_config_snapshot: {
    id: 'snapshot-1',
  },
  active_config_snapshot_id: 'snapshot-1',
  result: 'success',
})))

const publishAgentMutationOptions = vi.hoisted(() => vi.fn((options?: {
  onSuccess?: (
    data: PublishAgentResponse,
    variables: PublishAgentVariables,
  ) => void
}) => ({
  mutationFn: async (variables: PublishAgentVariables) => {
    const data = await publishAgentMutationFn(variables)
    options?.onSuccess?.(data, variables)
    return data
  },
})))

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
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
  baseConfig,
  currentModel,
}: {
  baseConfig?: Parameters<typeof useAgentConfigureSync>[0]['baseConfig']
  currentModel?: Parameters<typeof useAgentConfigureSync>[0]['currentModel']
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const store = createStore()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        {children}
      </JotaiProvider>
    </QueryClientProvider>
  )

  return {
    ...renderHook(() => useAgentConfigureSync({
      agentId: 'agent-1',
      baseConfig,
      currentModel,
      enabled: true,
    }), { wrapper }),
    queryClient,
    store,
  }
}

describe('useAgentConfigureSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should automatically save configure page changes to draft', async () => {
    vi.setSystemTime(1710000100000)
    const { queryClient, result, store } = renderUseAgentConfigureSync()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['agent-detail', 'agent-1'], {
      active_config_is_published: true,
      name: 'Agent',
    })

    expect(result.current.draftSavedAt).toBeUndefined()

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

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
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
    }))
    expect(queryClient.getQueryData(['agent-composer', 'agent-1'])).toEqual({
      agent_soul: expect.objectContaining({
        prompt: expect.objectContaining({
          system_prompt: 'Draft only prompt',
        }),
      }),
    })
    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['agent-detail', 'agent-1'],
    })
    expect(result.current.draftSavedAt).toBe(1710000105000)
  })

  it('should cancel pending autosave when the draft returns to the saved baseline', async () => {
    const { queryClient, result, store } = renderUseAgentConfigureSync()
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
    expect(result.current.draftSavedAt).toBeUndefined()
  })

  it('should include Agent Soul files when autosaving file changes', async () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        files: [
          {
            id: 'files/uploaded.md',
            name: 'uploaded.md',
            icon: 'markdown',
            fileId: 'drive-file-1',
            driveKey: 'files/uploaded.md',
          },
        ],
      })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        agent_soul: expect.objectContaining({
          files: {
            skills: [],
            files: [
              {
                id: 'files/uploaded.md',
                file_id: 'drive-file-1',
                name: 'uploaded.md',
                drive_key: 'files/uploaded.md',
              },
            ],
          },
        }),
      }),
    }))
  })

  it('should preserve uploaded files when prompt is updated immediately after upload', async () => {
    const { store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerFilesAtom, [
        {
          id: 'files/uploaded.md',
          name: 'uploaded.md',
          icon: 'markdown',
          fileId: 'drive-file-1',
          driveKey: 'files/uploaded.md',
        },
      ])
      store.set(agentComposerPromptAtom, 'Use [§file:files%2Fuploaded.md:uploaded.md§]')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        agent_soul: expect.objectContaining({
          prompt: expect.objectContaining({
            system_prompt: 'Use [§file:files%2Fuploaded.md:uploaded.md§]',
          }),
          files: {
            skills: [],
            files: [
              {
                id: 'files/uploaded.md',
                file_id: 'drive-file-1',
                name: 'uploaded.md',
                drive_key: 'files/uploaded.md',
              },
            ],
          },
        }),
      }),
    }))
  })

  it('should skip autosave when knowledge retrieval validation fails', async () => {
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
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(result.current.draftSavedAt).toBeUndefined()
  })

  it('should save the latest draft immediately when requested', async () => {
    vi.setSystemTime(1710000200000)
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
    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
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
    }))
    expect(result.current.draftSavedAt).toBe(1710000200000)
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
    expect(result.current.draftSavedAt).toBeUndefined()
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

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        agent_soul: expect.objectContaining({
          model: expect.objectContaining({
            model_provider: 'langgenius/openai/openai',
            model: 'gpt-4o-mini',
            plugin_id: 'langgenius/openai',
          }),
        }),
      }),
    }))
  })

  it('should reject manual save when knowledge retrieval validation fails', async () => {
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

    await expect(result.current.saveDraft()).rejects.toThrow('Agent knowledge retrieval configuration is invalid.')
    expect(composerPutMutationFn).not.toHaveBeenCalled()
  })

  it('should publish only when publishDraft is called explicitly', async () => {
    const { queryClient, result, store } = renderUseAgentConfigureSync()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['agent-detail', 'agent-1'], {
      active_config_is_published: false,
      name: 'Agent',
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

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
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
    }))
    expect(publishAgentMutationFn).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {},
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['agent-composer', 'agent-1'],
    })
    expect(queryClient.getQueryData(['agent-detail', 'agent-1'])).toEqual({
      active_config_is_published: true,
      name: 'Agent',
    })
    expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess')
  })

  it('should keep default model fallback from creating unpublished changes after publish', async () => {
    const { result, store } = renderUseAgentConfigureSync({
      currentModel: {
        provider: 'langgenius/openai/openai',
        model: 'gpt-4o-mini',
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
    const publishedDraft = store.get(agentComposerPublishedDraftAtom)
    expect(store.get(agentComposerDraftAtom).model).toBeUndefined()
    expect(publishedDraft?.model).toBeUndefined()
    expect(publishedDraft).toEqual(store.get(agentComposerDraftAtom))
  })

  it('should keep base config fallback fields from creating unpublished changes after publish', async () => {
    const { result, store } = renderUseAgentConfigureSync({
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
    const publishedDraft = store.get(agentComposerPublishedDraftAtom)
    expect(store.get(agentComposerDraftAtom).appFeatures).toBeUndefined()
    expect(publishedDraft?.appFeatures).toBeUndefined()
    expect(publishedDraft).toEqual(store.get(agentComposerDraftAtom))
  })

  it('should publish the current draft snapshot instead of a stale caller payload', async () => {
    const { result, store } = renderUseAgentConfigureSync()

    act(() => {
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        prompt: 'Current draft prompt',
      })
    })

    await act(async () => {
      await result.current.publishDraft()
    })

    expect(composerPutMutationFn).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        save_strategy: 'save_to_current_version',
        agent_soul: expect.objectContaining({
          prompt: expect.objectContaining({
            system_prompt: 'Current draft prompt',
          }),
        }),
      }),
    }))
    expect(publishAgentMutationFn).toHaveBeenCalledTimes(1)
  })

  it('should reject publish when knowledge retrieval validation fails', async () => {
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

    await expect(result.current.publishDraft()).rejects.toThrow('Agent knowledge retrieval configuration is invalid.')
    expect(composerPutMutationFn).not.toHaveBeenCalled()
    expect(publishAgentMutationFn).not.toHaveBeenCalled()
  })

  it('should expose publishing status from the publish mutation while publish is pending', async () => {
    const publishDeferred = createDeferredPromise<PublishAgentResponse>()
    publishAgentMutationFn.mockReturnValueOnce(publishDeferred.promise)
    const { result } = renderUseAgentConfigureSync()
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
})
