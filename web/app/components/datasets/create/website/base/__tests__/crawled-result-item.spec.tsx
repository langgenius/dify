import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrawledResultItem from '../crawled-result-item'

describe('CrawledResultItem', () => {
  const defaultProps = {
    payload: { title: 'Example Page', source_url: 'https://example.com/page' } as CrawlResultItemType,
    isChecked: false,
    isPreview: false,
    onCheckChange: vi.fn(),
    onPreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render title and url', () => {
    render(<CrawledResultItem {...defaultProps} />)
    expect(screen.getByText('Example Page')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/page')).toBeInTheDocument()
  })

  it('should apply active styling when isPreview', () => {
    const { container } = render(<CrawledResultItem {...defaultProps} isPreview={true} />)
    expect((container.firstChild as HTMLElement).className).toContain('bg-state-base-active')
  })

  it('should call onCheckChange with true when unchecked checkbox is clicked', () => {
    render(<CrawledResultItem {...defaultProps} isChecked={false} testId="crawl-item" />)
    const checkbox = screen.getByTestId('checkbox-crawl-item')
    fireEvent.click(checkbox)
    expect(defaultProps.onCheckChange).toHaveBeenCalledWith(true)
  })

  it('should call onCheckChange with false when checked checkbox is clicked', () => {
    render(<CrawledResultItem {...defaultProps} isChecked={true} testId="crawl-item" />)
    const checkbox = screen.getByTestId('checkbox-crawl-item')
    fireEvent.click(checkbox)
    expect(defaultProps.onCheckChange).toHaveBeenCalledWith(false)
  })
})
