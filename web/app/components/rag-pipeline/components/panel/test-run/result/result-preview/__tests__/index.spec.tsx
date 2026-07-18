import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkingMode } from '@/models/datasets'
import ResultPreview from '../index'

vi.mock('@/app/components/rag-pipeline/components/chunk-card-list', () => ({
  ChunkCardList: () => <div>Chunk preview</div>,
}))

describe('ResultPreview', () => {
  it('shows progress while results are pending', () => {
    render(<ResultPreview isRunning onSwitchToDetail={vi.fn()} />)

    expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
  })

  it('opens result details from an error', async () => {
    const user = userEvent.setup()
    const onSwitchToDetail = vi.fn()
    render(<ResultPreview error="failed" onSwitchToDetail={onSwitchToDetail} />)

    await user.click(
      screen.getByRole('button', { name: 'pipeline.result.resultPreview.viewDetails' }),
    )

    expect(onSwitchToDetail).toHaveBeenCalledOnce()
  })

  it('shows formatted output chunks', () => {
    render(
      <ResultPreview
        outputs={{ chunk_structure: ChunkingMode.text, preview: [{ content: 'answer' }] }}
        onSwitchToDetail={vi.fn()}
      />,
    )

    expect(screen.getByText('Chunk preview')).toBeInTheDocument()
  })
})
