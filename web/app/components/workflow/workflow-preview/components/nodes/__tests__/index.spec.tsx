import type { AgentV2NodeType } from '@/app/components/workflow/nodes/agent-v2/types'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from 'reactflow'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum } from '@/app/components/workflow/types'
import CustomNode from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({ 'workflow.nodes.agent.outputRoutes.route': 'Route {{index}}' })
})

describe('workflow preview custom node', () => {
  it('renders the mapped node component inside the shared base card', () => {
    const props: React.ComponentProps<typeof CustomNode> = {
      id: 'classifier-1',
      type: 'custom-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {
        type: BlockEnum.QuestionClassifier,
        title: 'Classifier node',
        desc: '',
        classes: [{ id: 'class-a', name: 'Billing' }],
      } as never,
    }

    const { container, getByText } = render(<CustomNode {...props} />, {
      wrapper: ReactFlowProvider,
    })

    expect(getByText('Classifier node')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="class-a"]')).toBeInTheDocument()
  })

  it('renders human input output handles from the mapped node component', () => {
    const props: React.ComponentProps<typeof CustomNode> = {
      id: 'human-input-1',
      type: 'custom-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {
        type: BlockEnum.HumanInput,
        title: 'Human Input',
        desc: '',
        delivery_methods: [],
        form_content: '',
        inputs: [],
        user_actions: [
          { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
        ],
        timeout: 1,
        timeout_unit: 'hour',
      } as never,
    }

    const { container, getByText } = render(<CustomNode {...props} />, {
      wrapper: ReactFlowProvider,
    })

    expect(getByText('Human Input')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="approve"]')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="__timeout"]')).toBeInTheDocument()
  })

  it.each([BlockEnum.Agent, BlockEnum.AgentV2])(
    'renders route labels and connections for %s while preserving the failure exit',
    (type) => {
      const data: AgentV2NodeType = {
        type,
        title: 'Agent',
        desc: '',
        agent_node_kind: 'dify_agent',
        version: '2',
        error_strategy: ErrorHandleTypeEnum.failBranch,
        agent_output_routes: {
          enabled: true,
          routes: [
            { id: 'accepted', name: 'The request is accepted', label: 'Accepted' },
            { id: 'rejected', name: 'The request is rejected' },
          ],
        },
      }
      const props: React.ComponentProps<typeof CustomNode> = {
        id: 'agent-1',
        type: 'custom-node',
        selected: false,
        zIndex: 1,
        isConnectable: false,
        dragging: false,
        xPos: 0,
        yPos: 0,
        dragHandle: undefined,
        data,
      }
      const { container, getByText, queryByText, rerender } = render(<CustomNode {...props} />, {
        wrapper: ReactFlowProvider,
      })
      // ReactFlow resolves the saved edges through these source handle IDs.
      const sourceHandles = () =>
        Array.from(container.querySelectorAll('.react-flow__handle.source'), (handle) =>
          handle.getAttribute('data-handleid'),
        ).sort()

      expect(getByText('Accepted')).toBeInTheDocument()
      expect(getByText('Route 2')).toBeInTheDocument()
      expect(sourceHandles()).toEqual(['accepted', 'fail-branch', 'rejected'])

      rerender(
        <CustomNode
          {...props}
          data={{ ...data, agent_output_routes: { ...data.agent_output_routes, enabled: false } }}
        />,
      )

      expect(queryByText('Accepted')).not.toBeInTheDocument()
      expect(sourceHandles()).toEqual(['fail-branch', 'source'])
    },
  )
})
