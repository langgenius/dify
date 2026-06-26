import type { AgentSoulConfig, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorkflowInlineAgentConfigureWorkspace } from '../agent-orchestrate-drawer-panel'

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
  AgentBuildChat: () => (
    <div role="region" aria-label="build-chat" />
  ),
}))

vi.mock('@/app/components/workflow/nodes/agent-v2/agent-soul-config', () => ({
  useWorkflowInlineAgentConfigureSync: () => ({
    draftSavedAt: undefined,
    saveDraft: vi.fn(),
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
  })

  describe('Working Directory', () => {
    it('should show the working directory panel when the header action is clicked', async () => {
      render(
        <WorkflowInlineAgentConfigureWorkspace
          agentId="agent-1"
          appId="app-1"
          inlineComposerState={createInlineComposerState()}
          isInline
          nodeId="node-1"
          open
        />,
      )

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
})
