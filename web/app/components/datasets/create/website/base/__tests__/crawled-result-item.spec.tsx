import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrawledResultItem from '../crawled-result-item'

describe('CrawledResultItem', () => {
  const defaultProps = {
    payload: {
      title: 'Example Page',
      source_url: 'https://example.com/page',
    } as CrawlResultItemType,
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

  it('should call onCheckChange with true when unchecked checkbox is clicked', () => {
    render(<CrawledResultItem {...defaultProps} isChecked={false} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Example Page https://example.com/page' })
    fireEvent.click(checkbox)
    expect(defaultProps.onCheckChange).toHaveBeenCalledWith(true)
  })

  it('should call onCheckChange with false when checked checkbox is clicked', () => {
    render(<CrawledResultItem {...defaultProps} isChecked={true} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Example Page https://example.com/page' })
    fireEvent.click(checkbox)
    expect(defaultProps.onCheckChange).toHaveBeenCalledWith(false)
  })
})
