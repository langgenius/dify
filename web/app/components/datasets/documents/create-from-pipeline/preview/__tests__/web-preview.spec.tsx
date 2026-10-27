import type { CrawlResultItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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

  it('shows the selected page source and content and closes its preview', async () => {
    const user = userEvent.setup()
    render(<WebPreview {...defaultProps} />)
    expect(screen.getByText('Test Page')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByText('Hello **markdown** content')).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(defaultProps.hidePreview).toHaveBeenCalledOnce()
  })
})
