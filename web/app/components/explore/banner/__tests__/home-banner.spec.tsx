import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getHomeBanners: vi.fn(),
}))

vi.mock('../data', () => ({
  getHomeBanners: mocks.getHomeBanners,
}))

vi.mock('../banner', () => ({
  Banner: ({
    banners,
    reserveCarouselSpace,
  }: {
    banners: Array<{ id: string }>
    reserveCarouselSpace?: boolean
  }) => (
    <div
      data-testid="home-banner"
      data-banner-ids={banners.map((banner) => banner.id).join(',')}
      data-reserves-carousel-space={reserveCarouselSpace}
    />
  ),
}))

async function renderHomeBanner() {
  const { HomeBanner } = await import('../home-banner')
  const element = await HomeBanner()
  if (element) render(element as ReactElement)
  return element
}

describe('HomeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getHomeBanners.mockResolvedValue([])
  })

  it('requests and renders banners without a feature gate', async () => {
    mocks.getHomeBanners.mockResolvedValue([{ id: 'banner-1' }, { id: 'banner-2' }])

    await renderHomeBanner()

    expect(mocks.getHomeBanners).toHaveBeenCalledOnce()
    expect(screen.getByTestId('home-banner')).toHaveAttribute(
      'data-banner-ids',
      'banner-1,banner-2',
    )
    expect(screen.getByTestId('home-banner')).toHaveAttribute(
      'data-reserves-carousel-space',
      'true',
    )
  })

  it('retains the greeting shell when the banner request fails', async () => {
    mocks.getHomeBanners.mockRejectedValue(new Error('Banner request failed'))

    await renderHomeBanner()

    expect(screen.getByTestId('home-banner')).toHaveAttribute('data-banner-ids', '')
    expect(screen.getByTestId('home-banner')).toHaveAttribute(
      'data-reserves-carousel-space',
      'true',
    )
  })
})
