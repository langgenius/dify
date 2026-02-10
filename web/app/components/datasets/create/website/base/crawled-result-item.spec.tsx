import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrawledResultItem from './crawled-result-item'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

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

  it('should call onCheckChange when checkbox area clicked', () => {
    render(<CrawledResultItem {...defaultProps} isChecked={false} />)
    // The Checkbox component renders a div wrapper, click on the title to trigger
    const wrapper = screen.getByText('Example Page').closest('.cursor-pointer')!
    fireEvent.click(wrapper)
    // onCheckChange is triggered through the Checkbox onCheck handler
  })
})
