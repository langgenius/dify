import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createTriggerNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Listening from '../listening'

const mockCopy = vi.hoisted(() => vi.fn())

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('../../hooks/use-tool-icon', () => ({
  useGetToolIcon: () => () => 'tool-icon',
}))

function ListeningPanel(props: ComponentProps<typeof Listening>) {
  const nodes = useNodes()
  return nodes.length ? <Listening {...props} /> : null
}

describe('variable inspect listening', () => {
  it('copies the listening trigger debug URL and lets the user stop listening', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()

    renderWorkflowFlowComponent(
      <ListeningPanel onStop={onStop} message="Waiting for webhook payload" />,
      {
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
      },
    )

    expect(await screen.findByText('Waiting for webhook payload')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowIntegrations.nodes.triggerWebhook.debugUrlCopy',
      }),
    )
    expect(mockCopy).toHaveBeenCalledWith('https://example.com/debug')

    await user.click(
      screen.getByRole('button', {
        name: 'workflowDebug.debug.variableInspect.listening.stopButton',
      }),
    )

    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
