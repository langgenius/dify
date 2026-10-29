import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createNodeTracing } from '../../../__tests__/fixtures'
import { NodeRunningStatus } from '../../../types'
import RetryResultPanel from '../retry-result-panel'

describe('RetryResultPanel', () => {
  it('should render every retry attempt with its details', async () => {
    const attempts = [
      createNodeTracing({
        id: 'retry-1',
        status: NodeRunningStatus.Retry,
        inputs: { attempt: 1 },
        process_data: { request: 'attempt-1' },
        outputs: { status_code: 500 },
        error: 'first failure',
        expand: true,
      }),
      createNodeTracing({
        id: 'retry-2',
        status: NodeRunningStatus.Retry,
        inputs: { attempt: 2 },
        process_data: { request: 'attempt-2' },
        outputs: { status_code: 503 },
        error: 'second failure',
        expand: true,
      }),
    ]

    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<RetryResultPanel list={attempts} onBack={onBack} />)

    expect(screen.getByText('workflow.nodes.common.retry.retry 1')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.common.retry.retry 2')).toBeInTheDocument()
    expect(await screen.findByText('first failure')).toBeInTheDocument()
    expect(screen.getByText('second failure')).toBeInTheDocument()
    expect(screen.getByText(/attempt-1/)).toBeInTheDocument()
    expect(screen.getByText(/attempt-2/)).toBeInTheDocument()
    expect(screen.getByText(/500/)).toBeInTheDocument()
    expect(screen.getByText(/503/)).toBeInTheDocument()
    await user.click(screen.getByText('workflow.singleRun.back'))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
