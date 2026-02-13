import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrawledResultItem from '../crawled-result-item'

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <button data-testid="preview-button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked, onCheck }: { checked: boolean, onCheck: () => void }) => (
    <input type="checkbox" data-testid="checkbox" checked={checked} onChange={onCheck} />
  ),
}))

vi.mock('@/app/components/base/radio/ui', () => ({
  default: ({ isChecked, onCheck }: { isChecked: boolean, onCheck: () => void }) => (
    <input type="radio" data-testid="radio" checked={isChecked} onChange={onCheck} />
  ),
}))

describe('CrawledResultItem', () => {
  const defaultProps = {
    payload: {
      title: 'Test Page',
      source_url: 'https://example.com/page',
      markdown: '',
      description: '',
    } satisfies CrawlResultItemType,
    isChecked: false,
    onCheckChange: vi.fn(),
    isPreview: false,
    showPreview: true,
    onPreview: vi.fn(),
    isMultipleChoice: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render title and URL', () => {
    render(<CrawledResultItem {...defaultProps} />)
    expect(screen.getByText('Test Page')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/page')).toBeInTheDocument()
  })

  it('should render checkbox in multiple choice mode', () => {
    render(<CrawledResultItem {...defaultProps} />)
    expect(screen.getByTestId('checkbox')).toBeInTheDocument()
  })

  it('should render radio in single choice mode', () => {
    render(<CrawledResultItem {...defaultProps} isMultipleChoice={false} />)
    expect(screen.getByTestId('radio')).toBeInTheDocument()
  })

  it('should show preview button when showPreview is true', () => {
    render(<CrawledResultItem {...defaultProps} />)
    expect(screen.getByTestId('preview-button')).toBeInTheDocument()
  })

  it('should not show preview button when showPreview is false', () => {
    render(<CrawledResultItem {...defaultProps} showPreview={false} />)
    expect(screen.queryByTestId('preview-button')).not.toBeInTheDocument()
  })
})
