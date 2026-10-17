import type {
  AgentSoulConfig,
  WorkflowAgentComposerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode, Ref } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderEditor as renderWithConsoleQuery } from '@/app/components/workflow/editor-resource/__tests__/render'
import { AgentScope } from '@/features/agent-v2/analytics'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { WorkflowInlineAgentConfigureWorkspace } from '../agent-orchestrate-panel-content'

const mocks = vi.hoisted(() => ({
  checkoutBuildDraft: vi.fn(),
  completeBuildConversation: undefined as (() => void) | undefined,
  deleteBuildDraft: vi.fn(),
  downloadAgentSandboxFile: vi.fn(),
  downloadWorkflowSandboxFile: vi.fn(),
  loadBuildDraft: vi.fn(),
  applyBuildDraft: vi.fn(),
  finalizeBuildChat: vi.fn(),
  refreshDebugConversation: vi.fn(),
  saveBuildDraft: vi.fn(),
  saveAgentSoulConfig: vi.fn(),
  saveDraft: vi.fn(),
  stopBuildChat: vi.fn(),
  trackEvent: vi.fn(),
  uploadAgentSandboxFile: vi.fn(),
  uploadWorkflowSandboxFile: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mocks.trackEvent,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: undefined,
  }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    textGenerationModelList: [],
  }),
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/orchestrate', async () => {
  const { useAtom } = await import('jotai')
  const { agentComposerDraftAtom } = await import('@/features/agent-v2/agent-composer/store')

  return {
    AgentOrchestratePanel: (props: {
      bottomAction?: ReactNode
      headerAction?: ReactNode
      isBuildDraftActive?: boolean
      readOnly?: boolean
    }) => {
      const [draft, setDraft] = useAtom(agentComposerDraftAtom)

      return (
        <div role="region" aria-label="orchestrate-panel">
          {props.headerAction}
          <input
            aria-label="local composer draft"
            readOnly={props.readOnly}
            value={draft.prompt}
            onChange={(event) =>
              setDraft({
                ...draft,
                prompt: event.currentTarget.value,
              })
            }
          />
          {props.bottomAction}
        </div>
      )
    },
  }
})

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/build-background', () => ({
  AgentBuildPanelBackground: () => null,
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/build-chat', async () => {
  const { useImperativeHandle, useState } = await import('react')

  return {
    AgentBuildChat: (props: {
      conversationId?: string | null
      controllerRef?: Ref<{ stop: () => void }>
      onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
      onConversationIdChange?: (conversationId: string) => void
      onSendInterrupted?: () => void
      onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
    }) => {
      const [messageSent, setMessageSent] = useState(false)
      const [sentPrompt, setSentPrompt] = useState<string | undefined>()
      useImperativeHandle(props.controllerRef, () => ({ stop: mocks.stopBuildChat }))
      mocks.completeBuildConversation = () =>
        props.onConversationComplete?.('build-conversation-new', 'workflow-run-1')

      return (
        <div role="region" aria-label="build-chat">
          <span>{`build:${props.conversationId ?? 'none'}`}</span>
          <span>{`sent:${messageSent ? 'yes' : 'no'}`}</span>
          <span>{`prompt:${sentPrompt ?? 'none'}`}</span>
          <button
            type="button"
            onClick={() => {
              void props.onSaveDraftBeforeRun?.().then(
                (agentSoulConfig) => {
                  setSentPrompt(agentSoulConfig?.prompt?.system_prompt)
                  setMessageSent(true)
                  props.onConversationIdChange?.('build-conversation-new')
                },
                () => undefined,
              )
            }}
          >
            send build message
          </button>
          <button type="button" onClick={() => mocks.completeBuildConversation?.()}>
            complete build conversation
          </button>
          <button
            type="button"
            onClick={() => {
              setMessageSent(true)
              props.onSendInterrupted?.()
            }}
          >
            fail build conversation
          </button>
        </div>
      )
    },
  }
})

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/preview-chat', () => ({
  AgentPreviewChat: (props: {
    answerActionPosition?: 'auto' | 'below'
    conversationId?: string | null
    onConversationIdChange?: (conversationId: string) => void
    onSaveDraftBeforeRun?: () => Promise<unknown>
  }) => (
    <div role="region" aria-label="preview-chat">
      <span>{`preview:${props.conversationId ?? 'none'}`}</span>
      <button
        type="button"
        onClick={() => {
          void props.onSaveDraftBeforeRun?.().then(() => {
            props.onConversationIdChange?.('preview-conversation-new')
          })
        }}
      >
        send preview message
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/agent-v2/agent-soul-config', () => ({
  useWorkflowInlineAgentConfigureSync: () => ({
    saveAgentSoulConfig: mocks.saveAgentSoulConfig,
    saveDraft: mocks.saveDraft,
  }),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createSystemFeaturesFixture } = await import('@/test/console/system-features')
  return {
    consoleClient: {
      agent: {
        byAgentId: {
          sandbox: {
            files: {
              upload: {
                post: mocks.uploadAgentSandboxFile,
              },
            },
          },
        },
      },
      apps: {
        byAppId: {
          workflowRuns: {
            byWorkflowRunId: {
              agentNodes: {
                byNodeId: {
                  sandbox: {
                    files: {
                      upload: {
                        post: mocks.uploadWorkflowSandboxFile,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    consoleQuery: {
      workspaces: actual.consoleQuery.workspaces,
      systemFeatures: {
        get: {
          queryKey: () => ['system-features'],
          queryOptions: () => ({
            queryKey: ['system-features'],
            initialData: createSystemFeaturesFixture(),
          }),
        },
      },
      agent: {
        byAgentId: {
          get: {
            queryKey: () => ['agent-detail'],
          },
          debugConversation: {
            refresh: {
              post: {
                mutationOptions: (options?: {
                  onSuccess?: (data: {
                    debug_conversation_has_messages: boolean
                    debug_conversation_id: string
                    debug_conversation_message_count: number
                  }) => void
                }) => ({
                  mutationFn: mocks.refreshDebugConversation,
                  ...options,
                }),
              },
            },
          },
          composer: {
            get: {
              queryOptions: vi.fn(),
            },
          },
          buildDraft: {
            get: {
              queryOptions: () => ({
                queryKey: ['build-draft'],
                queryFn: mocks.loadBuildDraft,
              }),
            },
            delete: {
              mutationOptions: () => ({ mutationFn: mocks.deleteBuildDraft }),
            },
            put: {
              mutationOptions: () => ({ mutationFn: mocks.saveBuildDraft }),
            },
            apply: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.applyBuildDraft }),
              },
            },
            checkout: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.checkoutBuildDraft }),
              },
            },
          },
          buildChat: {
            finalize: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.finalizeBuildChat }),
              },
            },
          },
          sandbox: {
            get: {
              queryOptions: () => ({
                queryKey: ['sandbox-info'],
                queryFn: () =>
                  Promise.resolve({
                    workspace_cwd: '.',
                  }),
              }),
            },
            files: {
              get: {
                key: () => ['agent-sandbox-files'],
                queryOptions: () => ({
                  queryKey: ['sandbox-files'],
                  queryFn: () =>
                    Promise.resolve({
                      entries: [
                        {
                          name: 'result.txt',
                          type: 'file',
                        },
                      ],
                      path: '.',
                    }),
                }),
              },
              read: {
                get: {
                  queryOptions: () => ({
                    queryKey: ['sandbox-file'],
                    queryFn: () =>
                      Promise.resolve({
                        text: 'result',
                      }),
                  }),
                },
              },
              download: {
                post: {
                  mutationOptions: () => ({ mutationFn: mocks.downloadAgentSandboxFile }),
                },
              },
              upload: {
                post: {
                  mutationOptions: () => ({ mutationFn: mocks.uploadAgentSandboxFile }),
                },
              },
            },
          },
        },
      },
      apps: {
        byAppId: {
          get: actual.consoleQuery.apps.byAppId.get,
          workflowRuns: {
            byWorkflowRunId: {
              agentNodes: {
                byNodeId: {
                  sandbox: {
                    files: {
                      get: {
                        key: () => ['workflow-agent-node-sandbox-files'],
                        queryOptions: () => ({
                          queryKey: ['workflow-agent-node-sandbox-files'],
                          queryFn: () =>
                            Promise.resolve({
                              entries: [
                                {
                                  name: 'result.txt',
                                  type: 'file',
                                },
                              ],
                              path: '.',
                            }),
                        }),
                      },
                      read: {
                        get: {
                          queryOptions: () => ({
                            queryKey: ['workflow-agent-node-sandbox-file'],
                            queryFn: () =>
                              Promise.resolve({
                                text: 'result',
                              }),
                          }),
                        },
                      },
                      download: {
                        post: {
                          mutationOptions: () => ({
                            mutationFn: mocks.downloadWorkflowSandboxFile,
                          }),
                        },
                      },
                      upload: {
                        post: {
                          mutationOptions: () => ({ mutationFn: mocks.uploadWorkflowSandboxFile }),
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          workflows: {
            draft: {
              nodes: {
                byNodeId: {
                  agentComposer: {
                    get: {
                      queryKey: ({
                        input,
                      }: {
                        input: {
                          params: {
                            app_id: string
                            node_id: string
                          }
                        }
                      }) => ['workflow-agent-composer', input.params.app_id, input.params.node_id],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
})

function createInlineComposerState({
  debugConversationHasMessages = false,
  debugConversationId = null,
  debugConversationMessageCount = 0,
  snapshotId = 'snapshot-1',
  systemPrompt = 'Help with workflow tasks.',
}: {
  debugConversationHasMessages?: boolean
  debugConversationId?: string | null
  debugConversationMessageCount?: number
  snapshotId?: string
  systemPrompt?: string
} = {}): WorkflowAgentComposerResponse {
  return {
    active_config_snapshot: {
      id: snapshotId,
    },
    agent: {
      id: 'agent-1',
      icon: 'A',
      icon_background: '#E0F2FE',
      icon_type: 'emoji',
      name: 'Inline Agent',
    },
    agent_soul: {
      schema_version: 1,
      prompt: {
        system_prompt: systemPrompt,
      },
    } satisfies AgentSoulConfig,
    binding: {
      id: 'binding-1',
      binding_type: 'inline_agent',
      agent_id: 'agent-1',
      current_snapshot_id: snapshotId,
      workflow_id: 'workflow-1',
      node_id: 'node-1',
    },
    debug_conversation_has_messages: debugConversationHasMessages,
    debug_conversation_id: debugConversationId,
    debug_conversation_message_count: debugConversationMessageCount,
  } as WorkflowAgentComposerResponse
}

const render: typeof renderWithConsoleQuery = (ui, options = {}) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'workflow' as const }))
  return renderWithConsoleQuery(ui, {
    queryClient,
    workspacePermissionKeys: ['agent.create'],
    ...options,
  })
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

describe('WorkflowInlineAgentConfigureWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of Object.values(mocks)) {
      if (vi.isMockFunction(mock)) mock.mockReset()
    }
    mocks.completeBuildConversation = undefined
    mocks.loadBuildDraft.mockRejectedValue(createHttpError(new Response(null, { status: 404 })))
    mocks.checkoutBuildDraft.mockResolvedValue({
      agent_soul: {},
      draft: {
        id: 'build-draft-1',
      },
      variant: 'agent_app',
    })
    mocks.deleteBuildDraft.mockResolvedValue({ result: 'success' })
    mocks.applyBuildDraft.mockResolvedValue({
      agent_soul: {},
      draft: {},
      variant: 'agent_app',
    })
    mocks.finalizeBuildChat.mockResolvedValue({ result: 'success' })
    mocks.refreshDebugConversation.mockResolvedValue({
      debug_conversation_has_messages: false,
      debug_conversation_id: 'build-conversation-refreshed',
      debug_conversation_message_count: 0,
    })
    mocks.saveBuildDraft.mockResolvedValue({
      agent_soul: {
        schema_version: 1,
        prompt: {
          system_prompt: 'Help with workflow tasks.',
        },
      },
      draft: {
        id: 'build-draft-1',
      },
      variant: 'agent_app',
    })
    mocks.saveDraft.mockResolvedValue(createInlineComposerState())
    mocks.saveAgentSoulConfig.mockResolvedValue(createInlineComposerState())
    mocks.uploadAgentSandboxFile.mockResolvedValue({
      url: 'https://example.com/agent-sandbox-file',
    })
    mocks.uploadWorkflowSandboxFile.mockResolvedValue({
      url: 'https://example.com/workflow-sandbox-file',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderWorkspace(
    props: {
      canCreateAgents?: boolean
      deploymentEdition?: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE'
      inlineComposerState?: WorkflowAgentComposerResponse
      onSaveInlineToRoster?: () => void
    } = {},
  ) {
    return render(
      <WorkflowInlineAgentConfigureWorkspace
        agentId="agent-1"
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
        inlineComposerState={props.inlineComposerState ?? createInlineComposerState()}
        nodeId="node-1"
        onSaveInlineToRoster={props.onSaveInlineToRoster}
        open
      />,
      {
        workspacePermissionKeys: props.canCreateAgents === false ? [] : ['agent.create'],
        systemFeatures: {
          deployment_edition: props.deploymentEdition ?? 'CLOUD',
        },
      },
    )
  }

  it('should load the build draft while the inline composer is pending', async () => {
    render(
      <WorkflowInlineAgentConfigureWorkspace
        agentId="agent-1"
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
        nodeId="node-1"
        open
      />,
    )

    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'orchestrate-panel' })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.loadBuildDraft).toHaveBeenCalledTimes(1))
  })

  it('loads the build draft only after the inline agent panel opens', async () => {
    const props = {
      agentId: 'agent-1',
      resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
      inlineComposerState: createInlineComposerState(),
      nodeId: 'node-1',
    }
    const { rerender } = render(<WorkflowInlineAgentConfigureWorkspace {...props} open={false} />)
    expect(mocks.loadBuildDraft).not.toHaveBeenCalled()
    rerender(<WorkflowInlineAgentConfigureWorkspace {...props} open />)
    await waitFor(() => expect(mocks.loadBuildDraft).toHaveBeenCalledOnce())
  })

  async function restartCurrentChat() {
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.preview.restart',
      }),
    )

    const confirmDialog = await screen.findByRole('alertdialog', {
      name: 'agentV2.agentDetail.configure.clearSessionConfirm.title',
    })
    expect(confirmDialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  }

  describe('Right panel mode', () => {
    it('should switch an inline agent between build and preview without creating a build draft from preview', async () => {
      const user = userEvent.setup()
      renderWorkspace()

      const previewButton = await screen.findByRole('radio', {
        name: 'agentV2.agentDetail.configure.rightPanel.preview',
      })
      expect(previewButton).toBeEnabled()

      await user.click(previewButton)

      expect(screen.getByRole('region', { name: 'preview-chat' })).toHaveTextContent('preview:none')
      expect(screen.queryByRole('region', { name: 'build-chat' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'send preview message' }))

      await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled())
      expect(mocks.trackEvent).toHaveBeenCalledWith('agent_preview_mode_run', {
        agent_scope: AgentScope.InWorkflow,
      })
      expect(mocks.saveBuildDraft).not.toHaveBeenCalled()

      await user.click(
        screen.getByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.build',
        }),
      )

      expect(screen.getByRole('region', { name: 'build-chat' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'preview-chat' })).not.toBeInTheDocument()
    })

    it('should refresh only the inline preview conversation when restarting preview mode', async () => {
      const user = userEvent.setup()
      renderWorkspace({
        inlineComposerState: createInlineComposerState({
          debugConversationHasMessages: true,
          debugConversationId: 'inline-build-conversation-1',
          debugConversationMessageCount: 1,
        }),
      })

      await user.click(
        await screen.findByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.preview',
        }),
      )
      await user.click(screen.getByRole('button', { name: 'send preview message' }))
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'preview-chat' })).toHaveTextContent(
          'preview:preview-conversation-new',
        )
      })
      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      )

      await waitFor(() => {
        expect(mocks.refreshDebugConversation).toHaveBeenCalledWith(
          {
            params: {
              agent_id: 'agent-1',
            },
            body: {
              draft_type: 'draft',
            },
          },
          expect.any(Object),
        )
      })
      expect(screen.getByRole('region', { name: 'preview-chat' })).toHaveTextContent('preview:none')

      await user.click(
        screen.getByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.build',
        }),
      )

      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
        'build:inline-build-conversation-1',
      )
    })

    it('should discard an active inline build session before switching to preview', async () => {
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes'),
      )

      await user.click(
        screen.getByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.preview',
        }),
      )

      expect(
        await screen.findByRole('alertdialog', {
          name: 'agentV2.agentDetail.configure.switchToPreviewConfirm.title',
        }),
      ).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'build-chat', hidden: true })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => expect(mocks.deleteBuildDraft).toHaveBeenCalled())
      expect(mocks.stopBuildChat).toHaveBeenCalledTimes(1)
      const stopBuildChatCallOrder = mocks.stopBuildChat.mock.invocationCallOrder[0]
      const deleteBuildDraftCallOrder = mocks.deleteBuildDraft.mock.invocationCallOrder[0]
      if (stopBuildChatCallOrder === undefined || deleteBuildDraftCallOrder === undefined)
        throw new Error('Expected Build stop and draft deletion calls.')
      expect(stopBuildChatCallOrder).toBeLessThan(deleteBuildDraftCallOrder)
      expect(screen.getByRole('region', { name: 'preview-chat' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'build-chat' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'send preview message' }))
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'preview-chat' })).toHaveTextContent(
          'preview:preview-conversation-new',
        )
      })
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeEnabled()
    })

    it('should wait for an in-flight inline build draft save and ignore its result after switching to preview', async () => {
      const user = userEvent.setup()
      const buildDraftSave = createDeferredPromise<{
        agent_soul: AgentSoulConfig
        draft: object
        variant: 'agent_app'
      }>()
      mocks.saveBuildDraft.mockReturnValue(buildDraftSave.promise)
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))
      await waitFor(() => expect(mocks.saveBuildDraft).toHaveBeenCalledTimes(1))

      await user.click(
        screen.getByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.preview',
        }),
      )
      await user.click(
        await screen.findByRole('button', {
          name: 'common.operation.confirm',
        }),
      )

      expect(mocks.deleteBuildDraft).not.toHaveBeenCalled()

      await act(async () => {
        buildDraftSave.resolve({
          agent_soul: {
            schema_version: 1,
            prompt: {
              system_prompt: 'Late build draft prompt.',
            },
          },
          draft: {},
          variant: 'agent_app',
        })
      })

      await waitFor(() => expect(mocks.deleteBuildDraft).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('region', { name: 'preview-chat' })).toBeInTheDocument()
      expect(screen.getByLabelText('local composer draft')).toHaveValue('Help with workflow tasks.')
    })

    it('should ignore a late inline build completion after leaving and re-entering build mode', async () => {
      const user = userEvent.setup()
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes'),
      )
      const completeBuildConversation = mocks.completeBuildConversation
      if (!completeBuildConversation) throw new Error('Expected a Build completion callback.')

      await user.click(
        screen.getByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.preview',
        }),
      )
      await user.click(
        await screen.findByRole('button', {
          name: 'common.operation.confirm',
        }),
      )
      await screen.findByRole('region', { name: 'preview-chat' })

      await user.click(
        screen.getByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.build',
        }),
      )
      await screen.findByRole('region', { name: 'build-chat' })
      const buildDraftLoadCount = mocks.loadBuildDraft.mock.calls.length

      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await act(async () => {
          completeBuildConversation()
          await vi.advanceTimersByTimeAsync(1000)
        })
        expect(mocks.loadBuildDraft).toHaveBeenCalledTimes(buildDraftLoadCount)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should confirm before discarding an existing inline build draft', async () => {
      const user = userEvent.setup()
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Existing build draft prompt.',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(
        await screen.findByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.preview',
        }),
      )

      expect(
        await screen.findByRole('alertdialog', {
          name: 'agentV2.agentDetail.configure.switchToPreviewConfirm.title',
        }),
      ).toBeInTheDocument()
      expect(mocks.deleteBuildDraft).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => expect(mocks.deleteBuildDraft).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('region', { name: 'preview-chat' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'build-chat' })).not.toBeInTheDocument()
    })

    it('should keep preview disabled for an inline agent in community edition', async () => {
      renderWorkspace({ deploymentEdition: 'COMMUNITY' })

      expect(
        await screen.findByRole('radio', {
          name: 'agentV2.agentDetail.configure.rightPanel.preview',
        }),
      ).toBeDisabled()
      expect(screen.getByRole('region', { name: 'build-chat' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'preview-chat' })).not.toBeInTheDocument()
    })
  })

  describe('Working Directory', () => {
    it('saves the inline agent to the roster from the header menu', async () => {
      const user = userEvent.setup()
      const onSaveInlineToRoster = vi.fn()
      renderWorkspace({ onSaveInlineToRoster })
      await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
      await user.click(
        await screen.findByRole('menuitem', { name: 'agentRoster.roster.saveToRoster' }),
      )
      expect(onSaveInlineToRoster).toHaveBeenCalledOnce()
    })

    it('should hide the save-to-roster menu when the user cannot create agents', async () => {
      renderWorkspace({
        canCreateAgents: false,
        onSaveInlineToRoster: vi.fn(),
      })

      await screen.findByRole('region', { name: 'orchestrate-panel' })
      expect(
        screen.queryByRole('button', { name: 'common.operation.more' }),
      ).not.toBeInTheDocument()
    })

    it('should show the working directory panel when the header action is clicked', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      renderWorkspace({
        inlineComposerState: createInlineComposerState({
          debugConversationHasMessages: true,
          debugConversationId: 'inline-debug-conversation-1',
          debugConversationMessageCount: 1,
        }),
      })

      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.workingDirectory.fileSystem',
        }),
      ).not.toBeInTheDocument()

      await user.click(
        await screen.findByRole('button', {
          name: 'send build message',
        }),
      )
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
          'build:build-conversation-new',
        ),
      )
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.workingDirectory.fileSystem',
        }),
      ).not.toBeInTheDocument()

      await user.click(
        await screen.findByRole('button', {
          name: 'complete build conversation',
        }),
      )
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.workingDirectory.fileSystem',
        }),
      ).toBeInTheDocument()

      await user.click(
        await screen.findByRole('button', {
          name: 'agentV2.agentDetail.configure.workingDirectory.fileSystem',
        }),
      )

      expect(
        await screen.findByRole('dialog', {
          name: 'result.txt',
        }),
      ).toBeInTheDocument()
      expect(await screen.findAllByText('result.txt')).not.toHaveLength(0)
    })
  })

  describe('Build Chat', () => {
    it('should save the workflow agent draft and write that snapshot into the build draft before starting build chat', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.saveDraft.mockResolvedValue(
        createInlineComposerState({
          snapshotId: 'snapshot-saved',
          systemPrompt: 'Saved workflow snapshot prompt.',
        }),
      )
      mocks.saveBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: { system_prompt: 'Normalized build draft prompt.' },
        },
        draft: { id: 'build-draft-1' },
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))

      await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled())
      expect(mocks.saveBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
          body: {
            variant: 'agent_app',
            save_strategy: 'save_to_current_version',
            agent_soul: expect.objectContaining({
              prompt: expect.objectContaining({
                system_prompt: 'Saved workflow snapshot prompt.',
              }),
            }),
          },
        },
        expect.any(Object),
      )
      const saveDraftCallOrder = mocks.saveDraft.mock.invocationCallOrder[0]
      const saveBuildDraftCallOrder = mocks.saveBuildDraft.mock.invocationCallOrder[0]
      expect(saveDraftCallOrder).toBeDefined()
      expect(saveBuildDraftCallOrder).toBeDefined()
      if (saveDraftCallOrder === undefined || saveBuildDraftCallOrder === undefined)
        throw new Error('Expected workflow draft and build draft saves to be called')

      expect(saveDraftCallOrder).toBeLessThan(saveBuildDraftCallOrder)
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
          'prompt:Normalized build draft prompt.',
        ),
      )
      expect(mocks.checkoutBuildDraft).not.toHaveBeenCalled()
      expect(mocks.trackEvent).toHaveBeenCalledWith('agent_build_mode_run', {
        agent_scope: AgentScope.InWorkflow,
      })
    })

    it('should enter build draft mode without resetting the current inline build chat', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.loadBuildDraft
        .mockRejectedValueOnce(createHttpError(new Response(null, { status: 404 })))
        .mockResolvedValue({
          agent_soul: {
            schema_version: 1,
            prompt: {
              system_prompt: 'Build draft prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        })
      mocks.saveBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Build draft prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      expect(
        await screen.findByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeDisabled()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))

      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes'),
      )
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
        'build:build-conversation-new',
      )
      expect(screen.getByRole('textbox', { name: 'local composer draft' })).toHaveAttribute(
        'readonly',
      )
      expect(
        screen.getByRole('group', { name: 'agentV2.agentDetail.configure.buildDraft.title' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' }),
      ).toBeDisabled()
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeDisabled()

      vi.useFakeTimers({ shouldAdvanceTime: true })
      await user.click(screen.getByRole('button', { name: 'complete build conversation' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(mocks.loadBuildDraft).toHaveBeenCalled()
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes')
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
        'build:build-conversation-new',
      )
      expect(screen.getByRole('button', { name: 'custom.apply' })).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeEnabled()
    })

    it('should seed inline build chat from the workflow composer debug conversation when reopening build draft', async () => {
      const user = userEvent.setup()
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Build draft prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })

      renderWorkspace({
        inlineComposerState: createInlineComposerState({
          debugConversationId: 'inline-debug-conversation-1',
        }),
      })

      expect(
        await screen.findByRole('group', {
          name: 'agentV2.agentDetail.configure.buildDraft.title',
        }),
      ).toBeInTheDocument()
      await user.click(
        screen.getByRole('button', { name: /agentDetail.configure.buildDraft.changesToApply/ }),
      )
      expect(await screen.findByText('build_note.md')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
        'build:inline-debug-conversation-1',
      )
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeEnabled()
    })

    it('should keep restart disabled when workflow composer debug conversation has no messages', async () => {
      renderWorkspace({
        inlineComposerState: createInlineComposerState({
          debugConversationHasMessages: false,
          debugConversationId: 'inline-debug-conversation-1',
          debugConversationMessageCount: 0,
        }),
      })

      expect(await screen.findByRole('region', { name: 'build-chat' })).toHaveTextContent(
        'build:inline-debug-conversation-1',
      )
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeDisabled()
    })

    it('should refresh inline debug conversation when restarting an existing debug chat', async () => {
      renderWorkspace({
        inlineComposerState: createInlineComposerState({
          debugConversationHasMessages: true,
          debugConversationId: 'inline-debug-conversation-1',
          debugConversationMessageCount: 1,
        }),
      })

      expect(await screen.findByRole('region', { name: 'build-chat' })).toHaveTextContent(
        'build:inline-debug-conversation-1',
      )
      await restartCurrentChat()

      await waitFor(() =>
        expect(mocks.refreshDebugConversation).toHaveBeenCalledWith(
          {
            params: {
              agent_id: 'agent-1',
            },
          },
          expect.any(Object),
        ),
      )
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
    })

    it('should re-enable inline build draft actions when build chat fails', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.loadBuildDraft
        .mockRejectedValueOnce(createHttpError(new Response(null, { status: 404 })))
        .mockResolvedValue({
          agent_soul: {
            schema_version: 1,
            prompt: {
              system_prompt: 'Build draft prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        })
      mocks.saveBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Build draft prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled(),
      )

      await user.click(screen.getByRole('button', { name: 'fail build conversation' }))

      expect(screen.getByRole('button', { name: 'custom.apply' })).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.preview.restart',
        }),
      ).toBeEnabled()
    })

    it('should not let a previous inline build completion refresh unlock a new build run', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Build draft prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await screen.findByRole('group', { name: 'agentV2.agentDetail.configure.buildDraft.title' })
      const initialBuildDraftLoadCount = mocks.loadBuildDraft.mock.calls.length

      await user.click(await screen.findByRole('button', { name: 'send build message' }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled(),
      )

      vi.useFakeTimers({ shouldAdvanceTime: true })
      await user.click(screen.getByRole('button', { name: 'complete build conversation' }))
      await user.click(screen.getByRole('button', { name: 'send build message' }))
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(mocks.loadBuildDraft).toHaveBeenCalledTimes(initialBuildDraftLoadCount)
      expect(screen.getByRole('button', { name: 'custom.apply' })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'agentV2.agentDetail.configure.buildDraft.discard' }),
      ).toBeDisabled()
    })

    it('should refresh the inline build debug conversation when restarting after a build send', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.loadBuildDraft
        .mockRejectedValueOnce(createHttpError(new Response(null, { status: 404 })))
        .mockResolvedValue({
          agent_soul: {
            schema_version: 1,
            prompt: {
              system_prompt: 'Build draft prompt',
            },
          },
          draft: {},
          variant: 'agent_app',
        })
      mocks.saveBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Build draft prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'send build message' }))
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent(
          'build:build-conversation-new',
        ),
      )

      await user.click(screen.getByRole('button', { name: 'fail build conversation' }))
      await restartCurrentChat()

      await waitFor(() =>
        expect(mocks.deleteBuildDraft).toHaveBeenCalledWith(
          {
            params: {
              agent_id: 'agent-1',
            },
          },
          expect.any(Object),
        ),
      )
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      )
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
    })

    it('should apply inline build draft through the workflow node composer owner', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Applied inline build prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'custom.apply' }))

      await waitFor(() =>
        expect(mocks.saveAgentSoulConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: 'Applied inline build prompt',
            }),
          }),
        ),
      )
      expect(mocks.deleteBuildDraft).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      )
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      )
      expect(mocks.applyBuildDraft).not.toHaveBeenCalled()
    })

    it('should keep exiting inline build draft when debug conversation refresh fails after applying', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.refreshDebugConversation.mockRejectedValueOnce(new Error('refresh failed'))
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Applied inline build prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(await screen.findByRole('button', { name: 'custom.apply' }))

      await waitFor(() => expect(mocks.saveAgentSoulConfig).toHaveBeenCalled())
      expect(mocks.deleteBuildDraft).toHaveBeenCalled()
      await waitFor(() =>
        expect(
          screen.queryByRole('group', { name: 'agentV2.agentDetail.configure.buildDraft.title' }),
        ).not.toBeInTheDocument(),
      )
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      expect(screen.getByRole('textbox', { name: 'local composer draft' })).not.toHaveAttribute(
        'readonly',
      )
    })

    it('should refresh the inline build debug conversation when discarding the build draft', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Discarded inline build prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(
        await screen.findByRole('button', {
          name: 'agentV2.agentDetail.configure.buildDraft.discard',
        }),
      )
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() =>
        expect(mocks.deleteBuildDraft).toHaveBeenCalledWith(
          {
            params: {
              agent_id: 'agent-1',
            },
          },
          expect.any(Object),
        ),
      )
      expect(mocks.refreshDebugConversation).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
        },
        expect.any(Object),
      )
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
    })

    it('should keep exiting inline build draft when debug conversation refresh fails after discarding', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      mocks.refreshDebugConversation.mockRejectedValueOnce(new Error('refresh failed'))
      mocks.loadBuildDraft.mockResolvedValue({
        agent_soul: {
          schema_version: 1,
          prompt: {
            system_prompt: 'Discarded inline build prompt',
          },
        },
        draft: {},
        variant: 'agent_app',
      })
      renderWorkspace()

      await user.click(
        await screen.findByRole('button', {
          name: 'agentV2.agentDetail.configure.buildDraft.discard',
        }),
      )
      await user.click(await screen.findByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => expect(mocks.deleteBuildDraft).toHaveBeenCalled())
      await waitFor(() =>
        expect(
          screen.queryByRole('group', { name: 'agentV2.agentDetail.configure.buildDraft.title' }),
        ).not.toBeInTheDocument(),
      )
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:none')
      expect(screen.getByRole('textbox', { name: 'local composer draft' })).not.toHaveAttribute(
        'readonly',
      )
    })

    it('preserves local edits when the inline snapshot changes', async () => {
      const user = userEvent.setup({
        advanceTimers: async (ms) => {
          if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(ms)
        },
      })
      const { rerender } = renderWorkspace({
        inlineComposerState: createInlineComposerState({ snapshotId: 'snapshot-1' }),
      })
      const localDraftInput = await screen.findByRole('textbox', { name: 'local composer draft' })

      await user.clear(localDraftInput)
      await user.type(localDraftInput, 'draft survives snapshot updates')

      rerender(
        <WorkflowInlineAgentConfigureWorkspace
          agentId="agent-1"
          resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}
          inlineComposerState={createInlineComposerState({ snapshotId: 'snapshot-2' })}
          nodeId="node-1"
          open
        />,
      )

      expect(screen.getByRole('textbox', { name: 'local composer draft' })).toHaveValue(
        'draft survives snapshot updates',
      )
    })
  })
})
