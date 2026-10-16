import type { ParentChildConfig } from '../../hooks'
import type { FileIndexingEstimateResponse } from '@/models/datasets'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PreviewPanel } from '../preview-panel'

vi.mock('@/app/components/base/badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="badge">{children}</span>
  ),
}))

vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="skeleton">{children}</div>
  ),
  SkeletonPoint: () => <span />,
  SkeletonRectangle: () => <span />,
  SkeletonRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../../../chunk', () => ({
  ChunkContainer: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div data-testid="chunk-container">
      {label}: {children}
    </div>
  ),
  QAPreview: ({ qa }: { qa: { question: string } }) => (
    <div data-testid="qa-preview">{qa.question}</div>
  ),
}))

vi.mock('../../../../common/document-picker/preview-document-picker', () => ({
  default: () => <div data-testid="doc-picker" />,
}))

vi.mock('../../../../documents/detail/completed/common/summary-label', () => ({
  default: ({ summary }: { summary: string }) => <span data-testid="summary">{summary}</span>,
}))

vi.mock('../../../../formatted-text/flavours/preview-slice', () => ({
  PreviewSlice: ({ label, text }: { label: string; text: string }) => (
    <span data-testid="preview-slice">
      {label}: {text}
    </span>
  ),
}))

vi.mock('../../../../formatted-text/formatted', () => ({
  FormattedText: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="formatted-text">{children}</p>
  ),
}))

vi.mock('../../../../preview/container', () => ({
  default: ({ children, header }: { children: React.ReactNode; header: React.ReactNode }) => (
    <div data-testid="preview-container">
      {header}
      {children}
    </div>
  ),
}))

vi.mock('@/config', () => ({
  FULL_DOC_PREVIEW_LENGTH: 3,
}))

describe('PreviewPanel', () => {
  const defaultProps = {
    isMobile: false,
    isOpen: false,
    onClose: vi.fn(),
    dataSourceType: DataSourceType.FILE,
    currentDocForm: ChunkingMode.text,
    parentChildConfig: { chunkForContext: 'paragraph' } as ParentChildConfig,
    pickerFiles: [{ id: '1', name: 'file.pdf', extension: 'pdf' }],
    pickerValue: { id: '1', name: 'file.pdf', extension: 'pdf' },
    isIdle: false,
    isPending: false,
    onPickerChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render preview header with title', () => {
    render(<PreviewPanel {...defaultProps} />)
    expect(
      screen.getByRole('heading', { name: 'datasetCreation.stepTwo.preview', level: 2 }),
    ).toHaveTextContent('datasetCreation.stepTwo.preview')
  })

  it('announces preview loading and completed chunk count through a persistent status', () => {
    const { rerender } = render(<PreviewPanel {...defaultProps} isPending />)
    expect(screen.getByRole('status')).toHaveTextContent('common.loading')
    rerender(
      <PreviewPanel
        {...defaultProps}
        estimate={{ total_segments: 3, preview: [] } as unknown as FileIndexingEstimateResponse}
      />,
    )
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

  it('should render document picker', () => {
    render(<PreviewPanel {...defaultProps} />)
    expect(screen.getByTestId('doc-picker')).toBeInTheDocument()
  })

  it('should show idle state when isIdle is true', () => {
    render(<PreviewPanel {...defaultProps} isIdle={true} />)
    expect(screen.getByText('datasetCreation.stepTwo.previewChunkTip')).toBeInTheDocument()
  })

  it('should show loading skeletons when isPending', () => {
    render(<PreviewPanel {...defaultProps} isPending={true} />)
    expect(screen.getAllByTestId('skeleton')).toHaveLength(10)
  })

  it('should render text preview chunks', () => {
    const estimate: Partial<FileIndexingEstimateResponse> = {
      total_segments: 2,
      preview: [
        { content: 'chunk 1 text', child_chunks: [], summary: '' },
        { content: 'chunk 2 text', child_chunks: [], summary: 'summary text' },
      ],
    }
    render(<PreviewPanel {...defaultProps} estimate={estimate as FileIndexingEstimateResponse} />)
    expect(screen.getAllByTestId('chunk-container')).toHaveLength(2)
  })

  it('should render QA preview', () => {
    const estimate: Partial<FileIndexingEstimateResponse> = {
      qa_preview: [{ question: 'Q1', answer: 'A1' }],
    }
    render(
      <PreviewPanel
        {...defaultProps}
        currentDocForm={ChunkingMode.qa}
        estimate={estimate as FileIndexingEstimateResponse}
      />,
    )
    expect(screen.getByTestId('qa-preview')).toHaveTextContent('Q1')
  })

  it('should render parent-child preview', () => {
    const estimate: Partial<FileIndexingEstimateResponse> = {
      preview: [{ content: 'parent chunk', child_chunks: ['child1', 'child2'], summary: '' }],
    }
    render(
      <PreviewPanel
        {...defaultProps}
        currentDocForm={ChunkingMode.parentChild}
        estimate={estimate as FileIndexingEstimateResponse}
      />,
    )
    expect(screen.getAllByTestId('preview-slice')).toHaveLength(2)
  })

  it('should show badge with chunk count for non-QA mode', () => {
    const estimate: Partial<FileIndexingEstimateResponse> = { total_segments: 5, preview: [] }
    render(<PreviewPanel {...defaultProps} estimate={estimate as FileIndexingEstimateResponse} />)
    expect(screen.getByTestId('badge')).toBeInTheDocument()
  })
})
