import type { ComponentProps } from 'react'
import type { Banner } from '@/models/app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BannerItem } from '../banner-item'

const mockTrackEvent = vi.fn()

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const createMockBanner = (overrides: Partial<Banner> = {}): Banner =>
  ({
    id: 'banner-1',
    status: 'enabled',
    link: 'https://example.com',
    content: {
      category: 'Featured',
      title: 'Test Banner Title',
      description: 'Test banner description text',
      'img-src': 'https://example.com/image.png',
    },
    ...overrides,
  }) as Banner

const renderBannerItem = (
  banner: Banner = createMockBanner(),
  props: Partial<ComponentProps<typeof BannerItem>> = {},
) => render(<BannerItem banner={banner} sort={1} language="en-US" {...props} />)

describe('BannerItem', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the banner content and a decorative image', () => {
    const { container } = renderBannerItem()

    expect(screen.getByText('Featured')).toBeInTheDocument()
    expect(screen.getAllByText('Test Banner Title')).toHaveLength(2)
    expect(screen.getByText('Test banner description text')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/image.png')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('uses a native external link for the card navigation', () => {
    renderBannerItem()

    const link = screen.getByRole('link', { name: 'Test Banner Title' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('tracks navigation through the link', () => {
    renderBannerItem(createMockBanner({ link: 'https://test-link.com' }), {
      sort: 2,
      language: 'zh-Hans',
      accountId: 'account-123',
    })

    fireEvent.click(screen.getByRole('link', { name: 'Test Banner Title' }))

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
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('associates the link accessible name with the visible title', () => {
    renderBannerItem()

    const link = screen.getByRole('link', { name: 'Test Banner Title' })
    const title = document.getElementById(link.getAttribute('aria-labelledby')!)

    expect(title).toHaveTextContent('Test Banner Title')
  })
})
