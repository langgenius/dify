import { fireEvent, screen } from '@testing-library/react'
import { createTriggerNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Listening from '../listening'

const mockCopy = vi.hoisted(() => vi.fn())

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({
  useGetToolIcon: () => () => 'tool-icon',
}))

describe('variable inspect listening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the listening message and forwards the stop action', () => {
    const onStop = vi.fn()

    renderWorkflowFlowComponent(<Listening onStop={onStop} message="Waiting for webhook payload" />, {
      nodes: [
        createTriggerNode(BlockEnum.TriggerWebhook, {
          id: 'trigger-1',
          data: {
            title: 'Webhook Trigger',
            webhook_debug_url: 'https://example.com/debug',
          },
        }),
      ],
      edges: [],
      initialStoreState: {
        listeningTriggerType: BlockEnum.TriggerWebhook,
        listeningTriggerNodeId: 'trigger-1',
        listeningTriggerNodeIds: [],
        listeningTriggerIsAll: false,
      },
    })

    expect(screen.getByText('Waiting for webhook payload')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workflow.debug.variableInspect.listening.stopButton' }))

    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
