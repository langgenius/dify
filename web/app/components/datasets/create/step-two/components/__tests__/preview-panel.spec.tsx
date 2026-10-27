import type { IndexingEstimateResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PreviewPanel } from '../preview-panel'

const estimateBase: IndexingEstimateResponse = {
  currency: 'USD',
  tokens: 0,
  total_price: 0,
  total_segments: 0,
  preview: [],
}

describe('PreviewPanel', () => {
  const defaultProps = {
    isMobile: false,
    isOpen: false,
    onClose: vi.fn(),
    dataSourceType: DataSourceType.FILE,
    currentDocForm: ChunkingMode.text,
    parentChildConfig: {
      chunkForContext: 'paragraph' as const,
      parent: { delimiter: '\\n\\n', maxLength: 2000 },
      child: { delimiter: '\\n', maxLength: 500 },
    },
    pickerFiles: [{ id: '1', name: 'file.pdf', extension: 'pdf' }],
    pickerValue: { id: '1', name: 'file.pdf', extension: 'pdf' },
    isIdle: false,
    isPending: false,
    onPickerChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('announces preview loading and completed chunk count through a persistent status', () => {
    const { rerender } = render(<PreviewPanel {...defaultProps} isPending />)
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    rerender(<PreviewPanel {...defaultProps} estimate={{ ...estimateBase, total_segments: 3 }} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'datasetCreation.stepTwo.previewChunkCount',
    )
  })

  it('allows mobile preview to close, restore focus, and reopen', async () => {
    const user = userEvent.setup()
    const MobilePreview = () => {
      const [isOpen, setIsOpen] = useState(false)
      const triggerRef = useRef<HTMLButtonElement>(null)

      return (
        <>
          <button ref={triggerRef} type="button" onClick={() => setIsOpen(true)}>
            Preview chunks
          </button>
          <PreviewPanel
            {...defaultProps}
            isMobile
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            finalFocus={triggerRef}
          />
        </>
      )
    }

    render(<MobilePreview />)
    const trigger = screen.getByRole('button', { name: 'Preview chunks' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'datasetCreation.stepTwo.preview' })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('dialog', { name: 'datasetCreation.stepTwo.preview' }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('should show idle state when isIdle is true', () => {
    render(<PreviewPanel {...defaultProps} isIdle={true} />)
    expect(screen.getByText('datasetCreation.stepTwo.previewChunkTip')).toBeInTheDocument()
  })

  it('should render text preview chunks', () => {
    const estimate: IndexingEstimateResponse = {
      ...estimateBase,
      total_segments: 2,
      preview: [
        { content: 'chunk 1 text', child_chunks: [], summary: '' },
        { content: 'chunk 2 text', child_chunks: [], summary: 'summary text' },
      ],
    }
    render(<PreviewPanel {...defaultProps} estimate={estimate} />)
    expect(screen.getByText('chunk 1 text')).toBeInTheDocument()
    expect(screen.getByText('chunk 2 text')).toBeInTheDocument()
    expect(screen.getByText('summary text')).toBeInTheDocument()
  })

  it('should render QA preview', () => {
    const estimate: IndexingEstimateResponse = {
      ...estimateBase,
      qa_preview: [{ question: 'Q1', answer: 'A1' }],
    }
    render(<PreviewPanel {...defaultProps} currentDocForm={ChunkingMode.qa} estimate={estimate} />)
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.getByText('A1')).toBeInTheDocument()
  })

  it('should render parent-child preview', () => {
    const estimate: IndexingEstimateResponse = {
      ...estimateBase,
      preview: [{ content: 'parent chunk', child_chunks: ['child1', 'child2'], summary: '' }],
    }
    render(
      <PreviewPanel
        {...defaultProps}
        currentDocForm={ChunkingMode.parentChild}
        estimate={estimate}
      />,
    )
    expect(screen.getByText('child1')).toBeInTheDocument()
    expect(screen.getByText('child2')).toBeInTheDocument()
  })
})
