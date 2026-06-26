import type { AgentSoulConfig, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkflowInlineAgentConfigureWorkspace } from '../agent-orchestrate-drawer-panel'

const mocks = vi.hoisted(() => ({
  checkoutBuildDraft: vi.fn(),
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
  AgentOrchestratePanel: () => (
    <div role="region" aria-label="orchestrate-panel" />
  ),
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/build-background', () => ({
  AgentBuildPanelBackground: () => null,
}))

vi.mock('@/features/agent-v2/agent-detail/configure/components/preview/build-chat', () => ({
  AgentBuildChat: (props: {
    onSaveDraftBeforeRun?: () => Promise<void>
  }) => (
    <div role="region" aria-label="build-chat">
      <button
        type="button"
        onClick={() => {
          void props.onSaveDraftBeforeRun?.()
        }}
      >
        start build
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/agent-v2/agent-soul-config', () => ({
  useWorkflowInlineAgentConfigureSync: () => ({
    draftSavedAt: undefined,
    saveDraft: mocks.saveDraft,
  }),
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

function createInlineComposerState(): WorkflowAgentComposerResponse {
  return {
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
      current_snapshot_id: 'snapshot-1',
      workflow_id: 'workflow-1',
      node_id: 'node-1',
    },
  } as WorkflowAgentComposerResponse
}

describe('WorkflowInlineAgentConfigureWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkoutBuildDraft.mockResolvedValue({
      agent_soul: {},
      draft: {},
      variant: 'agent_app',
    })
    mocks.saveDraft.mockResolvedValue(createInlineComposerState())
  })

  function renderWorkspace() {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowInlineAgentConfigureWorkspace
          agentId="agent-1"
          appId="app-1"
          inlineComposerState={createInlineComposerState()}
          isInline
          nodeId="node-1"
          open
        />
      </QueryClientProvider>,
    )
  }

  describe('Working Directory', () => {
    it('should show the working directory panel when the header action is clicked', async () => {
      renderWorkspace()

      fireEvent.click(screen.getByRole('button', {
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

      fireEvent.click(screen.getByRole('button', { name: 'start build' }))

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
  })
})
