import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentConfigurePage } from '../page'

const mocks = vi.hoisted(() => ({
  applyBuildDraft: vi.fn(),
  checkoutBuildDraft: vi.fn(),
  discardBuildDraft: vi.fn(),
  refreshDebugConversation: vi.fn(),
  queryState: {
    agent: {
      data: {
        debug_conversation_id: 'debug-conversation-old',
        icon: 'agent',
        icon_background: '#E0F2FE',
        icon_type: 'emoji',
        name: 'Research Agent',
      },
      isFetching: false,
      isError: false,
      isPending: false,
      isSuccess: true,
    },
    composer: {
      data: undefined as unknown,
      isFetching: true,
      isError: false,
      isPending: true,
      isSuccess: false,
      refetch: vi.fn(),
    },
    version: {
      data: undefined as unknown,
      isFetching: false,
      isError: false,
      isPending: false,
      isSuccess: false,
    },
    buildDraft: {
      data: undefined as unknown,
      dataUpdatedAt: 0,
      error: null as unknown,
      isFetching: false,
      isError: false,
      isPending: false,
      isSuccess: false,
      refetch: vi.fn(),
    },
  },
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useQuery: vi.fn((options: { queryKey?: readonly string[] }) => {
      const queryKey = options.queryKey?.[0]

      if (queryKey === 'agent')
        return mocks.queryState.agent
      if (queryKey === 'composer')
        return mocks.queryState.composer
      if (queryKey === 'version')
        return mocks.queryState.version
      if (queryKey === 'build-draft')
        return mocks.queryState.buildDraft

      return {
        data: undefined,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: false,
      }
    }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      get: {
        key: () => ['agents'],
      },
      byAgentId: {
        get: {
          queryOptions: () => ({ queryKey: ['agent'] }),
          queryKey: () => ['agent'],
        },
        debugConversation: {
          refresh: {
            post: {
              mutationOptions: (options?: { onSuccess?: (data: { debug_conversation_id: string }) => void }) => ({
                mutationFn: mocks.refreshDebugConversation,
                ...options,
              }),
            },
          },
        },
        publish: {
          post: {
            mutationOptions: () => ({ mutationFn: vi.fn() }),
          },
        },
        composer: {
          get: {
            queryOptions: () => ({ queryKey: ['composer'] }),
            queryKey: () => ['composer'],
          },
          put: {
            mutationOptions: () => ({ mutationFn: vi.fn() }),
          },
        },
        buildDraft: {
          get: {
            queryOptions: () => ({ queryKey: ['build-draft'] }),
          },
          checkout: {
            post: {
              mutationOptions: () => ({ mutationFn: mocks.checkoutBuildDraft }),
            },
          },
          apply: {
            post: {
              mutationOptions: () => ({ mutationFn: mocks.applyBuildDraft }),
            },
          },
          delete: {
            mutationOptions: () => ({ mutationFn: mocks.discardBuildDraft }),
          },
        },
        versions: {
          byVersionId: {
            get: {
              queryOptions: () => ({ queryKey: ['version'] }),
            },
          },
          get: {
            key: () => ['versions'],
          },
        },
      },
    },
  },
}))

vi.mock('../build-draft-query', () => ({
  agentConfigureConsoleQuery: {
    agent: {
      byAgentId: {
        buildDraft: {
          get: {
            queryOptions: () => ({
              queryFn: vi.fn(),
              queryKey: ['build-draft'],
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: undefined }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    textGenerationModelList: [],
  }),
}))

vi.mock('../components/orchestrate', async () => {
  const { useAtomValue } = await import('jotai')
  const { agentComposerPromptAtom } = await import('@/features/agent-v2/agent-composer/store-modules/prompt')

  return {
    AgentOrchestratePanel: (props: {
      bottomAction?: ReactNode
      isBuildDraftActive?: boolean
      onOpenVersions?: () => void
      readOnly?: boolean
      showPublishBar?: boolean
    }) => {
      const prompt = useAtomValue(agentComposerPromptAtom)

      return (
        <div role="region" aria-label="orchestrate-panel">
          <span>{`buildDraft:${props.isBuildDraftActive ? 'yes' : 'no'}`}</span>
          <span>{`readonly:${props.readOnly ? 'yes' : 'no'}`}</span>
          <span>{`publish:${props.showPublishBar ? 'yes' : 'no'}`}</span>
          <span>{`prompt:${prompt}`}</span>
          <button type="button" onClick={props.onOpenVersions}>open versions</button>
          {props.bottomAction}
        </div>
      )
    },
  }
})

vi.mock('../components/orchestrate/build-draft-bar', () => ({
  AgentBuildDraftBar: (props: {
    changesCount: number
    disabled?: boolean
    onApply: () => void
    onDiscard: () => void
  }) => (
    <div role="region" aria-label="build-draft-bar">
      <span>{`changes:${props.changesCount}`}</span>
      <button type="button" disabled={props.disabled} onClick={props.onApply}>apply build draft</button>
      <button type="button" disabled={props.disabled} onClick={props.onDiscard}>discard build draft</button>
    </div>
  ),
}))

vi.mock('../components/preview/build-chat', async () => {
  const { useState } = await import('react')

  return {
    AgentBuildChat: (props: {
      conversationId?: string | null
      onConversationComplete?: () => void
      onConversationIdChange?: (conversationId: string) => void
      onSaveDraftBeforeRun?: () => Promise<void>
    }) => {
      const [messageSent, setMessageSent] = useState(false)

      return (
        <div role="region" aria-label="build-chat">
          <span>{`build:${props.conversationId ?? 'none'}`}</span>
          <span>{`sent:${messageSent ? 'yes' : 'no'}`}</span>
          <button type="button" onClick={() => props.onConversationIdChange?.('build-conversation-new')}>
            save build conversation
          </button>
          <button
            type="button"
            onClick={() => {
              void props.onSaveDraftBeforeRun?.().then(() => {
                setMessageSent(true)
                props.onConversationIdChange?.('build-conversation-new')
              })
            }}
          >
            send build message
          </button>
          <button type="button" onClick={() => props.onConversationComplete?.()}>
            complete build conversation
          </button>
        </div>
      )
    },
  }
})

vi.mock('../components/preview/preview-chat', () => ({
  AgentPreviewChat: (props: {
    conversationId?: string | null
    onConversationIdChange?: (conversationId: string) => void
  }) => (
    <div role="region" aria-label="preview-chat">
      <span>{`preview:${props.conversationId ?? 'none'}`}</span>
      <button type="button" onClick={() => props.onConversationIdChange?.('preview-conversation-new')}>
        save preview conversation
      </button>
    </div>
  ),
}))

vi.mock('../components/preview/chat-features-panel', () => ({
  AgentChatFeaturesPanel: (props: {
    appFeatures?: {
      opening_statement?: string
    }
    disabled?: boolean
    show: boolean
  }) => props.show
    ? (
        <div role="region" aria-label="chat-features-panel">
          <span>{`chatFeaturesDisabled:${props.disabled ? 'yes' : 'no'}`}</span>
          <span>{`opening:${props.appFeatures?.opening_statement ?? ''}`}</span>
        </div>
      )
    : null,
}))

vi.mock('../components/preview/header', () => ({
  AgentPreviewHeader: (props: {
    mode: 'build' | 'preview'
    previewEnabled: boolean
    onModeChange: (mode: 'build' | 'preview') => void
    onToggleChatFeatures: () => void
    onOpenWorkingDirectory: () => void
    onRefresh: () => void
    refreshDisabled?: boolean
  }) => (
    <div>
      <div>{props.mode}</div>
      <button type="button" disabled={!props.previewEnabled} onClick={() => props.onModeChange('preview')}>
        preview mode
      </button>
      <button type="button" onClick={() => props.onModeChange('build')}>
        build mode
      </button>
      <button type="button" onClick={props.onToggleChatFeatures}>
        chat features
      </button>
      <button type="button" onClick={props.onOpenWorkingDirectory}>
        open working directory
      </button>
      <button type="button" disabled={props.refreshDisabled} onClick={props.onRefresh}>
        restart preview
      </button>
    </div>
  ),
}))

vi.mock('../components/preview/versions-panel', () => ({
  AgentPreviewVersionsPanel: (props: { onSelectVersion: (versionId: string) => void }) => (
    <button type="button" onClick={() => props.onSelectVersion('snapshot-2')}>select version</button>
  ),
}))

describe('AgentConfigurePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshDebugConversation.mockResolvedValue({
      debug_conversation_id: 'debug-conversation-new',
    })
    mocks.applyBuildDraft.mockResolvedValue({ result: 'success', draft: {} })
    mocks.checkoutBuildDraft.mockResolvedValue({
      variant: 'agent_app',
      draft: {},
      agent_soul: {},
    })
    mocks.discardBuildDraft.mockResolvedValue({ result: 'success' })
    mocks.queryState.agent = {
      data: {
        icon: 'agent',
        icon_background: '#E0F2FE',
        icon_type: 'emoji',
        name: 'Research Agent',
        debug_conversation_id: 'debug-conversation-old',
      },
      isFetching: false,
      isError: false,
      isPending: false,
      isSuccess: true,
    }
    mocks.queryState.composer = {
      data: undefined as unknown,
      isFetching: true,
      isError: false,
      isPending: true,
      isSuccess: false,
      refetch: vi.fn(),
    }
    mocks.queryState.version = {
      data: undefined as unknown,
      isFetching: false,
      isError: false,
      isPending: false,
      isSuccess: false,
    }
    mocks.queryState.buildDraft = {
      data: undefined as unknown,
      dataUpdatedAt: 0,
      error: null,
      isFetching: false,
      isError: false,
      isPending: false,
      isSuccess: false,
      refetch: vi.fn(),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Loading state', () => {
    it('should show the page loading indicator instead of skeleton panels while composer data is pending', () => {
      const queryClient = new QueryClient()

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      const configureSection = screen.getByRole('region', { name: 'agentV2.agentDetail.sections.configure' })
      expect(configureSection).toHaveAttribute('aria-busy', 'true')
      expect(configureSection).toHaveClass('bg-background-body')
      expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'orchestrate-panel' })).not.toBeInTheDocument()
    })
  })

  describe('Right panel mode', () => {
    it('should keep preview disabled and stay in build mode', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:debug-conversation-old')
      expect(screen.queryByRole('region', { name: 'preview-chat' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'save build conversation' }))

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:build-conversation-new')
      expect(mocks.refreshDebugConversation).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'restart preview' }))

      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')

      const previewButton = screen.getByRole('button', { name: 'preview mode' })
      expect(previewButton).toBeDisabled()

      await user.click(previewButton)

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      expect(screen.queryByRole('region', { name: 'preview-chat' })).not.toBeInTheDocument()
    })

    it('should keep preview disabled', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      const previewButton = screen.getByRole('button', { name: 'preview mode' })
      expect(previewButton).toBeDisabled()

      await user.click(previewButton)

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:debug-conversation-old')
      expect(screen.queryByRole('region', { name: 'preview-chat', hidden: true })).not.toBeInTheDocument()
    })

    it('should disable restart when there is no conversation or build draft to reset', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.agent = {
        ...mocks.queryState.agent,
        data: {
          ...mocks.queryState.agent.data,
          debug_conversation_id: '',
        },
      }
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      const restartButton = screen.getByRole('button', { name: 'restart preview' })

      expect(restartButton).toBeDisabled()

      await user.click(restartButton)

      expect(mocks.refreshDebugConversation).not.toHaveBeenCalled()
    })

    it('should stay in normal draft mode when build draft returns 404 even if a debug conversation exists', () => {
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: undefined as unknown,
        dataUpdatedAt: 0,
        error: new Response(null, { status: 404 }),
        isFetching: false,
        isError: true,
        isPending: false,
        isSuccess: false,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('readonly:no')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:no')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('publish:yes')
      expect(screen.queryByRole('region', { name: 'build-draft-bar' })).not.toBeInTheDocument()
    })

    it('should keep build draft query refresh owned by explicit workflow actions', () => {
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      let buildDraftQueryOptions: unknown
      for (const [options] of vi.mocked(useQuery).mock.calls) {
        if (Array.isArray(options.queryKey) && options.queryKey[0] === 'build-draft') {
          buildDraftQueryOptions = options
          break
        }
      }

      expect(buildDraftQueryOptions).toMatchObject({
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      })
    })

    it('should enter build draft mode when build draft data exists', () => {
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('readonly:yes')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:yes')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('publish:no')
      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()
    })

    it('should show chat features from the active build draft source as read-only', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            app_features: {
              opening_statement: 'draft opening',
            },
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            app_features: {
              opening_statement: 'build opening',
            },
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('button', { name: 'chat features' }))

      expect(screen.getByRole('region', { name: 'chat-features-panel' })).toHaveTextContent('chatFeaturesDisabled:yes')
      expect(screen.getByRole('region', { name: 'chat-features-panel' })).toHaveTextContent('opening:build opening')
    })

    it('should switch to build draft mode without resetting the sending chat when sending from normal draft mode', async () => {
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: undefined as unknown,
        dataUpdatedAt: 0,
        error: new Response(null, { status: 404 }),
        isFetching: false,
        isError: true,
        isPending: false,
        isSuccess: false,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('readonly:no')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:no')

      fireEvent.click(screen.getByRole('button', { name: 'send build message' }))

      await waitFor(() => {
        expect(mocks.checkoutBuildDraft).toHaveBeenCalledWith({
          params: {
            agent_id: 'agent-1',
          },
          body: {
            force: false,
          },
        }, expect.any(Object))
      })
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes')
      })
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:build-conversation-new')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('readonly:yes')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:yes')
      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'apply build draft' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'discard build draft' })).toBeDisabled()
    })

    it('should keep the build draft bar disabled while a build conversation is responding', async () => {
      vi.useFakeTimers()
      const queryClient = new QueryClient()
      const refetchBuildDraft = vi.fn().mockResolvedValue({})
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: refetchBuildDraft,
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'send build message' }))

      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes')
      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'apply build draft' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'discard build draft' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'complete build conversation' }))

      expect(refetchBuildDraft).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(refetchBuildDraft).toHaveBeenCalled()
      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'apply build draft' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'discard build draft' })).toBeEnabled()
    })

    it('should not let a previous build completion refresh unlock a new build run', async () => {
      vi.useFakeTimers()
      const queryClient = new QueryClient()
      const refetchBuildDraft = vi.fn().mockResolvedValue({})
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: refetchBuildDraft,
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'send build message' }))
      await act(async () => {
        await Promise.resolve()
      })
      fireEvent.click(screen.getByRole('button', { name: 'complete build conversation' }))
      fireEvent.click(screen.getByRole('button', { name: 'send build message' }))
      await act(async () => {
        await Promise.resolve()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(refetchBuildDraft).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'apply build draft' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'discard build draft' })).toBeDisabled()
    })

    it('should discard the build draft when restarting build mode with a build draft', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {},
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('button', { name: 'restart preview' }))

      await waitFor(() => expect(mocks.discardBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      ))
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
    })

    it('should switch soul source to view version when selecting a version from build draft mode', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'open versions' }))
      await user.click(screen.getByRole('button', { name: 'select version' }))

      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('readonly:yes')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('publish:yes')
      expect(screen.queryByRole('region', { name: 'build-draft-bar' })).not.toBeInTheDocument()
    })

    it('should apply the build draft and rebase the composer store from the refetched normal draft', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
      const refetchComposer = vi.fn(async () => {
        mocks.queryState.composer = {
          ...mocks.queryState.composer,
          data: {
            agent_soul: {
              prompt: {
                system_prompt: 'applied prompt',
              },
            },
          },
        }

        return {}
      })
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'old draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: refetchComposer,
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('button', { name: 'apply build draft' }))

      await waitFor(() => expect(mocks.applyBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      ))
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['agent'],
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['agents'],
      })
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))
      expect(refetchComposer).toHaveBeenCalled()
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('prompt:applied prompt')
      })
    })

    it('should keep exiting build draft when debug conversation refresh fails after applying build draft', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      const refetchComposer = vi.fn(async () => {
        mocks.queryState.composer = {
          ...mocks.queryState.composer,
          data: {
            agent_soul: {
              prompt: {
                system_prompt: 'applied prompt',
              },
            },
          },
        }

        return {}
      })
      mocks.refreshDebugConversation.mockRejectedValueOnce(new Error('refresh failed'))
      mocks.queryState.composer = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'old draft prompt',
            },
          },
        },
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: refetchComposer,
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {
            prompt: {
              system_prompt: 'build prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('button', { name: 'apply build draft' }))

      await waitFor(() => expect(mocks.applyBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      ))
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))
      expect(refetchComposer).toHaveBeenCalled()
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:no')
        expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('prompt:applied prompt')
      })
    })

    it('should discard the build draft and start a new build session', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {},
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('button', { name: 'discard build draft' }))

      await waitFor(() => expect(mocks.discardBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      ))
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
    })

    it('should keep exiting build draft when debug conversation refresh fails after discarding build draft', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      mocks.refreshDebugConversation.mockRejectedValueOnce(new Error('refresh failed'))
      mocks.queryState.composer = {
        data: {},
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }
      mocks.queryState.buildDraft = {
        data: {
          agent_soul: {},
          draft: {},
          variant: 'agent_app',
        },
        dataUpdatedAt: 1,
        error: null,
        isFetching: false,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
      }

      render(
        <QueryClientProvider client={queryClient}>
          <AgentConfigurePage agentId="agent-1" />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('button', { name: 'discard build draft' }))

      await waitFor(() => expect(mocks.discardBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      ))
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:no')
      })
    })
  })
})
