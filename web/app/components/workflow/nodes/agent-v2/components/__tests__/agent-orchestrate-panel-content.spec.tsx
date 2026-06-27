import type { AgentSoulConfig, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkflowInlineAgentConfigureWorkspace } from '../agent-orchestrate-panel-content'

const mocks = vi.hoisted(() => ({
  checkoutBuildDraft: vi.fn(),
  deleteBuildDraft: vi.fn(),
  loadBuildDraft: vi.fn(),
  applyBuildDraft: vi.fn(),
  saveAgentSoulConfig: vi.fn(),
  saveDraft: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: undefined,
  }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    textGenerationModelList: [],
  }),
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/orchestrate', () => ({
  AgentOrchestratePanel: (props: {
    bottomAction?: ReactNode
    headerAction?: ReactNode
    isBuildDraftActive?: boolean
    readOnly?: boolean
  }) => (
    <div role="region" aria-label="orchestrate-panel">
      <span>{`readonly:${props.readOnly ? 'yes' : 'no'}`}</span>
      <span>{`buildDraft:${props.isBuildDraftActive ? 'yes' : 'no'}`}</span>
      {props.headerAction}
      <input aria-label="local composer draft" defaultValue="" />
      {props.bottomAction}
    </div>
  ),
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/orchestrate/build-draft-bar', () => ({
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

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/build-background', () => ({
  AgentBuildPanelBackground: () => null,
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/build-chat', async () => {
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

vi.mock('@/app/components/workflow/nodes/agent-v2/agent-soul-config', () => ({
  useWorkflowInlineAgentConfigureSync: () => ({
    draftSavedAt: undefined,
    saveAgentSoulConfig: mocks.saveAgentSoulConfig,
    saveDraft: mocks.saveDraft,
  }),
}))

vi.mock('@/features/agent-v2/agent-detail/configure/build-draft-query', () => ({
  agentConfigureConsoleQuery: {
    agent: {
      byAgentId: {
        buildDraft: {
          get: {
            queryOptions: () => ({
              queryKey: ['build-draft'],
              queryFn: mocks.loadBuildDraft,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        composer: {
          get: {
            queryOptions: vi.fn(),
          },
        },
        buildDraft: {
          get: {
            queryOptions: () => ({ queryKey: ['build-draft'] }),
          },
          delete: {
            mutationOptions: () => ({ mutationFn: mocks.deleteBuildDraft }),
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
      },
    },
  },
}))

function createInlineComposerState({
  snapshotId = 'snapshot-1',
}: {
  snapshotId?: string
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
        system_prompt: 'Help with workflow tasks.',
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
  } as WorkflowAgentComposerResponse
}

describe('WorkflowInlineAgentConfigureWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadBuildDraft.mockRejectedValue(new Response(null, { status: 404 }))
    mocks.checkoutBuildDraft.mockResolvedValue({
      agent_soul: {},
      draft: {},
      variant: 'agent_app',
    })
    mocks.deleteBuildDraft.mockResolvedValue({ result: 'success' })
    mocks.applyBuildDraft.mockResolvedValue({
      agent_soul: {},
      draft: {},
      variant: 'agent_app',
    })
    mocks.saveDraft.mockResolvedValue(createInlineComposerState())
    mocks.saveAgentSoulConfig.mockResolvedValue(createInlineComposerState())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderWorkspace(props: {
    inlineComposerState?: WorkflowAgentComposerResponse
    onSaveInlineToRoster?: () => void
  } = {}) {
    const queryClient = new QueryClient()

    return render(
      <QueryClientProvider client={queryClient}>
        <WorkflowInlineAgentConfigureWorkspace
          agentId="agent-1"
          appId="app-1"
          inlineComposerState={props.inlineComposerState ?? createInlineComposerState()}
          nodeId="node-1"
          onSaveInlineToRoster={props.onSaveInlineToRoster}
          open
        />
      </QueryClientProvider>,
    )
  }

  describe('Working Directory', () => {
    it('should show save-to-roster in the configure header menu without rendering the old action bar', async () => {
      renderWorkspace({
        onSaveInlineToRoster: vi.fn(),
      })

      expect(await screen.findByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.cancel' })).not.toBeInTheDocument()
    })

    it('should show the working directory panel when the header action is clicked', async () => {
      renderWorkspace()

      fireEvent.click(await screen.findByRole('button', {
        name: 'agentV2.agentDetail.configure.workingDirectory.open',
      }))

      expect(await screen.findByRole('dialog', {
        name: 'agentV2.agentDetail.configure.workingDirectory.title',
      })).toBeInTheDocument()
      expect(screen.getByRole('region', {
        name: 'agentV2.agentDetail.configure.workingDirectory.treeLabel',
      })).toBeInTheDocument()
    })
  })

  describe('Build Chat', () => {
    it('should save the workflow agent draft and checkout a build draft before starting build chat', async () => {
      renderWorkspace()

      fireEvent.click(await screen.findByRole('button', { name: 'send build message' }))

      await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalled())
      expect(mocks.checkoutBuildDraft).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          force: false,
        },
      }, expect.any(Object))
      const saveDraftCallOrder = mocks.saveDraft.mock.invocationCallOrder[0]
      const checkoutBuildDraftCallOrder = mocks.checkoutBuildDraft.mock.invocationCallOrder[0]
      expect(saveDraftCallOrder).toBeDefined()
      expect(checkoutBuildDraftCallOrder).toBeDefined()
      if (saveDraftCallOrder === undefined || checkoutBuildDraftCallOrder === undefined)
        throw new Error('Expected save draft and checkout mutations to be called')

      expect(saveDraftCallOrder).toBeLessThan(checkoutBuildDraftCallOrder)
    })

    it('should enter build draft mode without resetting the current inline build chat', async () => {
      mocks.loadBuildDraft
        .mockRejectedValueOnce(new Response(null, { status: 404 }))
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
      mocks.checkoutBuildDraft.mockResolvedValue({
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

      fireEvent.click(await screen.findByRole('button', { name: 'send build message' }))

      await waitFor(() => expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes'))
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:build-conversation-new')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('readonly:yes')
      expect(screen.getByRole('region', { name: 'orchestrate-panel' })).toHaveTextContent('buildDraft:yes')
      expect(screen.getByRole('region', { name: 'build-draft-bar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'apply build draft' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'discard build draft' })).toBeDisabled()

      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('button', { name: 'complete build conversation' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(mocks.loadBuildDraft).toHaveBeenCalled()
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('sent:yes')
      expect(screen.getByRole('region', { name: 'build-chat' })).toHaveTextContent('build:build-conversation-new')
      expect(screen.getByRole('button', { name: 'apply build draft' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'discard build draft' })).toBeEnabled()
    })

    it('should apply inline build draft through the workflow node composer owner', async () => {
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

      fireEvent.click(await screen.findByRole('button', { name: 'apply build draft' }))

      await waitFor(() => expect(mocks.saveAgentSoulConfig).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.objectContaining({
          system_prompt: 'Applied inline build prompt',
        }),
      })))
      expect(mocks.deleteBuildDraft).toHaveBeenCalledWith({
        params: {
          agent_id: 'agent-1',
        },
      }, expect.any(Object))
      expect(mocks.applyBuildDraft).not.toHaveBeenCalled()
    })

    it('should keep the composer session mounted when the inline snapshot changes', async () => {
      const { rerender } = renderWorkspace({
        inlineComposerState: createInlineComposerState({ snapshotId: 'snapshot-1' }),
      })
      const localDraftInput = await screen.findByRole('textbox', { name: 'local composer draft' })

      fireEvent.change(localDraftInput, { target: { value: 'draft still mounted' } })

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <WorkflowInlineAgentConfigureWorkspace
            agentId="agent-1"
            appId="app-1"
            inlineComposerState={createInlineComposerState({ snapshotId: 'snapshot-2' })}
            nodeId="node-1"
            open
          />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('textbox', { name: 'local composer draft' })).toHaveValue('draft still mounted')
    })
  })
})
