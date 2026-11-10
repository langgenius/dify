import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { BannerItem } from '../banner-item'

const mockTrackEvent = vi.fn()
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const createMockBanner = (overrides: Partial<BannerResponse> = {}): BannerResponse => ({
  id: 'banner-1',
  status: 'enabled',
  link: 'https://example.com',
  created_at: '2024-01-01T00:00:00Z',
  content: {
    category: 'Featured',
    title: 'Test Banner Title',
    description: 'Test banner description text',
    'img-src': 'https://example.com/image.png',
  },
  sort: 1,
  ...overrides,
})

const renderBannerItem = (
  banner: BannerResponse = createMockBanner(),
  props: Partial<ComponentProps<typeof BannerItem>> = {},
) =>
  render(<BannerItem banner={banner} sort={1} language="en-US" titleId="banner-title" {...props} />)

describe('BannerItem', () => {
  it('names the external destination and tracks navigation through it', async () => {
    const user = userEvent.setup()
    renderBannerItem(createMockBanner({ link: 'https://test-link.com' }), {
      sort: 2,
      language: 'zh-Hans',
      accountId: 'account-123',
    })

    const link = screen.getByRole('link', { name: 'Test Banner Title' })
    link.addEventListener('click', (event) => event.preventDefault())
    expect(link).toHaveAttribute('href', 'https://test-link.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await user.click(link)

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'explore_banner_click',
      expect.objectContaining({
        banner_id: 'banner-1',
        title: 'Test Banner Title',
        sort: 2,
        link: 'https://test-link.com',
        page: 'explore',
        language: 'zh-Hans',
        account_id: 'account-123',
        event_time: expect.any(Number),
      }),
    )
  })

  it('renders a non-interactive article when no destination exists', () => {
    renderBannerItem(createMockBanner({ link: '' }))

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveTextContent('Test Banner Title')
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })
})
