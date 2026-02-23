/**
 * Integration test: RunBatch CSV upload → Run flow
 *
 * Tests the complete user journey:
 *   Upload CSV → parse → enable run → click run → results finish → run again
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import RunBatch from '@/app/components/share/text-generation/run-batch'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(() => 'pc'),
  MediaType: { pc: 'pc', pad: 'pad', mobile: 'mobile' },
}))

// Capture the onParsed callback from CSVReader to simulate CSV uploads
let capturedOnParsed: ((data: string[][]) => void) | undefined

vi.mock('@/app/components/share/text-generation/run-batch/csv-reader', () => ({
  default: ({ onParsed }: { onParsed: (data: string[][]) => void }) => {
    capturedOnParsed = onParsed
    return <div data-testid="csv-reader">CSV Reader</div>
  },
}))

vi.mock('@/app/components/share/text-generation/run-batch/csv-download', () => ({
  default: ({ vars }: { vars: { name: string }[] }) => (
    <div data-testid="csv-download">
      {vars.map(v => v.name).join(', ')}
    </div>
  ),
}))

describe('RunBatch – integration flow', () => {
  const vars = [{ name: 'prompt' }, { name: 'context' }]

  beforeEach(() => {
    capturedOnParsed = undefined
    vi.clearAllMocks()
  })

  it('full lifecycle: upload CSV → run → finish → run again', async () => {
    const onSend = vi.fn()

    const { rerender } = render(
      <RunBatch vars={vars} onSend={onSend} isAllFinished />,
    )

    // Phase 1 – verify child components rendered
    expect(screen.getByTestId('csv-reader')).toBeInTheDocument()
    expect(screen.getByTestId('csv-download')).toHaveTextContent('prompt, context')

    // Run button should be disabled before CSV is parsed
    const runButton = screen.getByRole('button', { name: 'share.generation.run' })
    expect(runButton).toBeDisabled()

    // Phase 2 – simulate CSV upload
    const csvData = [
      ['prompt', 'context'],
      ['Hello', 'World'],
      ['Goodbye', 'Moon'],
    ]
    await act(async () => {
      capturedOnParsed?.(csvData)
    })

    // Run button should now be enabled
    await waitFor(() => {
      expect(runButton).not.toBeDisabled()
    })

    // Phase 3 – click run
    fireEvent.click(runButton)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith(csvData)

    // Phase 4 – simulate results still running
    rerender(<RunBatch vars={vars} onSend={onSend} isAllFinished={false} />)
    expect(runButton).toBeDisabled()

    // Phase 5 – results finish → can run again
    rerender(<RunBatch vars={vars} onSend={onSend} isAllFinished />)
    await waitFor(() => {
      expect(runButton).not.toBeDisabled()
    })

    onSend.mockClear()
    fireEvent.click(runButton)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('should remain disabled when CSV not uploaded even if all finished', () => {
    const onSend = vi.fn()
    render(<RunBatch vars={vars} onSend={onSend} isAllFinished />)

    const runButton = screen.getByRole('button', { name: 'share.generation.run' })
    expect(runButton).toBeDisabled()

    fireEvent.click(runButton)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('should show spinner icon when results are still running', async () => {
    const onSend = vi.fn()
    const { container } = render(
      <RunBatch vars={vars} onSend={onSend} isAllFinished={false} />,
    )

    // Upload CSV first
    await act(async () => {
      capturedOnParsed?.([['data']])
    })

    // Button disabled + spinning icon
    const runButton = screen.getByRole('button', { name: 'share.generation.run' })
    expect(runButton).toBeDisabled()

    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('animate-spin')
  })
})
