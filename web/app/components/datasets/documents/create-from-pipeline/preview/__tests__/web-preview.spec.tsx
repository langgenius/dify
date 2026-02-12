import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebPreview from '../web-preview'

describe('WebPreview', () => {
  const defaultProps = {
    currentWebsite: {
      title: 'Test Page',
      source_url: 'https://example.com',
      markdown: 'Hello **markdown** content',
      description: '',
    } satisfies CrawlResultItem,
    hidePreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render preview label', () => {
    render(<WebPreview {...defaultProps} />)
    expect(screen.getByText('datasetPipeline.addDocuments.stepOne.preview')).toBeInTheDocument()
  })

  it('should render page title', () => {
    render(<WebPreview {...defaultProps} />)
    expect(screen.getByText('Test Page')).toBeInTheDocument()
  })

  it('should render source URL', () => {
    render(<WebPreview {...defaultProps} />)
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
  })

  it('should render markdown content', () => {
    render(<WebPreview {...defaultProps} />)
    expect(screen.getByText('Hello **markdown** content')).toBeInTheDocument()
  })

  it('should call hidePreview when close button clicked', () => {
    render(<WebPreview {...defaultProps} />)
    const buttons = screen.getAllByRole('button')
    const closeBtn = buttons[buttons.length - 1]
    fireEvent.click(closeBtn)
    expect(defaultProps.hidePreview).toHaveBeenCalled()
  })
})
