import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Result from '../index'

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      workflowRunningData: {
        result: { status: 'succeeded', outputs: { answer: 'done' } },
        tracing: [{ id: 'trace-1' }],
      },
    }),
}))

vi.mock('../result-preview', () => ({
  default: ({ onSwitchToDetail }: { onSwitchToDetail: () => void }) => (
    <button type="button" onClick={onSwitchToDetail}>
      Result preview
    </button>
  ),
}))

vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: () => <div>Result detail</div>,
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: () => <div>Tracing detail</div>,
}))

describe('Result', () => {
  it('switches between preview, detail, and tracing', async () => {
    const user = userEvent.setup()
    render(<Result />)

    expect(screen.getByRole('button', { name: 'Result preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'runLog.detail' }))
    expect(screen.getByText('Result detail')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(screen.getByText('Tracing detail')).toBeInTheDocument()
  })
})
