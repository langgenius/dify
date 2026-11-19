import type { CommonNodeType } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import RetryOnPanel from '../retry-on-panel'

function Panel() {
  const nodes = useNodes<CommonNodeType>()
  const node = nodes.find((item) => item.id === 'node-1')
  if (!node) return null
  return <RetryOnPanel id={node.id} data={node.data} />
}

it('persists retry edits and restores them after disabling and enabling retry', async () => {
  const user = userEvent.setup()
  renderWorkflowFlowComponent(<Panel />, {
    nodes: [
      createNode({
        id: 'node-1',
        data: { retry_config: { retry_enabled: true, max_retries: 3, retry_interval: 1000 } },
      }),
    ],
    hooksStoreProps: { doSyncWorkflowDraft: vi.fn() },
  })
  const maxRetriesLabel = 'workflow.nodes.common.retry.maxRetries'
  const retryIntervalLabel = 'workflow.nodes.common.retry.retryInterval'
  const input = await screen.findByRole('textbox', { name: maxRetriesLabel })
  await user.click(input)
  await user.keyboard('{ArrowUp}')
  expect(input).toHaveValue('4')
  expect(screen.getByRole('slider', { name: maxRetriesLabel })).toHaveAttribute(
    'aria-valuetext',
    '4 workflow.nodes.common.retry.times',
  )
  expect(screen.getByRole('slider', { name: retryIntervalLabel })).toHaveAttribute(
    'aria-valuetext',
    '1000 workflow.nodes.common.retry.ms',
  )

  const toggle = screen.getByRole('switch', { name: 'workflow.nodes.common.retry.retryOnFailure' })
  await user.click(toggle)
  expect(screen.queryByRole('textbox', { name: maxRetriesLabel })).not.toBeInTheDocument()
  await user.click(toggle)
  expect(screen.getByRole('textbox', { name: maxRetriesLabel })).toHaveValue('4')
  expect(screen.getByRole('textbox', { name: retryIntervalLabel })).toHaveValue('1000')
})
