import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createNodeTracing } from '../../../__tests__/fixtures'
import IterationResultPanel from '../iteration-result-panel'

const createTrace = (id: string, overrides: Partial<NodeTracing> = {}): NodeTracing =>
  createNodeTracing({
    id,
    node_id: `node-${id}`,
    title: `Iteration Step ${id}`,
    elapsed_time: 0.2,
    status: NodeRunningStatus.Succeeded,
    execution_metadata: {
      total_tokens: 0,
      total_price: 0,
      currency: 'USD',
      iteration_index: 0,
      parallel_mode_run_id: 'iter-1',
    },
    ...overrides,
  })

describe('IterationResultPanel', () => {
  it('shows iteration duration, toggles tracing details, and calls onBack', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const iterDurationMap: IterationDurationMap = { 'iter-1': 1.2 }
    render(
      <IterationResultPanel
        list={[[createTrace('1')]]}
        onBack={onBack}
        iterDurationMap={iterDurationMap}
      />,
    )

    expect(screen.getByText('1.20s')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Iteration Step 1/ })).not.toBeInTheDocument()

    screen.getByRole('button', { name: /workflow.singleRun.iteration 1/ }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: /workflow.singleRun.iteration 1/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: /Iteration Step 1/ })).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.queryByRole('button', { name: /Iteration Step 1/ })).not.toBeInTheDocument()

    await user.click(screen.getByText('workflow.singleRun.back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
