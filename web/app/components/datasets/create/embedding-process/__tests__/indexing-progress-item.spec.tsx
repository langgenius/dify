import type { ReactNode } from 'react'
import type { IndexingStatusResponse } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceType } from '@/models/datasets'
import IndexingProgressItem from '../indexing-progress-item'

vi.mock('@/app/components/billing/priority-label', () => ({
  default: () => <span data-testid="priority-label">Priority</span>,
}))
vi.mock('../../../common/document-file-icon', () => ({
  default: ({ name }: { name?: string }) => <span data-testid="file-icon">{name}</span>,
}))
vi.mock('@/app/components/base/notion-icon', () => ({
  default: ({ src }: { src?: string }) => <span data-testid="notion-icon">{src}</span>,
}))
vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children?: ReactNode, popupContent?: ReactNode }) => (
    <div data-testid="tooltip" data-content={popupContent}>{children}</div>
  ),
}))

describe('IndexingProgressItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeDetail = (overrides: Partial<IndexingStatusResponse> = {}): IndexingStatusResponse => ({
    id: 'doc-1',
    indexing_status: 'indexing',
    processing_started_at: 0,
    parsing_completed_at: 0,
    cleaning_completed_at: 0,
    splitting_completed_at: 0,
    completed_at: null,
    paused_at: null,
    error: null,
    stopped_at: null,
    completed_segments: 50,
    total_segments: 100,
    ...overrides,
  })

  it('should render name and progress for embedding status', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail()}
        name="test.pdf"
        sourceType={DataSourceType.FILE}
      />,
    )

    // Name appears in both the file-icon mock and the display div; verify at least one
    expect(screen.getAllByText('test.pdf').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('should render file icon for FILE source type', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail()}
        name="report.docx"
        sourceType={DataSourceType.FILE}
      />,
    )

    expect(screen.getByTestId('file-icon')).toBeInTheDocument()
  })

  it('should render notion icon for NOTION source type', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail()}
        name="My Page"
        sourceType={DataSourceType.NOTION}
        notionIcon="notion-icon-url"
      />,
    )

    expect(screen.getByTestId('notion-icon')).toBeInTheDocument()
  })

  it('should render success icon for completed status', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail({ indexing_status: 'completed' })}
        name="done.pdf"
      />,
    )

    // No progress percentage should be shown for completed
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('should render error icon with tooltip for error status', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail({ indexing_status: 'error', error: 'Parse failed' })}
        name="broken.pdf"
      />,
    )

    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'Parse failed')
  })

  it('should show priority label when billing is enabled', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail()}
        name="test.pdf"
        enableBilling={true}
      />,
    )

    expect(screen.getByTestId('priority-label')).toBeInTheDocument()
  })

  it('should not show priority label when billing is disabled', () => {
    render(
      <IndexingProgressItem
        detail={makeDetail()}
        name="test.pdf"
        enableBilling={false}
      />,
    )

    expect(screen.queryByTestId('priority-label')).not.toBeInTheDocument()
  })

  it('should apply error styling for error status', () => {
    const { container } = render(
      <IndexingProgressItem
        detail={makeDetail({ indexing_status: 'error' })}
        name="error.pdf"
      />,
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('bg-state-destructive-hover-alt')
  })
})
