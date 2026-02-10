import type { CrawlResultItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebPreview from './web-preview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiCloseLine: () => <span data-testid="close-icon" />,
  RiGlobalLine: () => <span data-testid="global-icon" />,
}))

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
    expect(screen.getByText('addDocuments.stepOne.preview')).toBeInTheDocument()
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
    const closeBtn = screen.getByTestId('close-icon').closest('button')!
    fireEvent.click(closeBtn)
    expect(defaultProps.hidePreview).toHaveBeenCalled()
  })
})
