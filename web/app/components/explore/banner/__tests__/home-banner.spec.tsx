import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureSystemFeatures: vi.fn(),
  getHomeBanners: vi.fn(),
  systemFeaturesQueryOptions: vi.fn(),
}))

vi.mock('../data', () => ({
  getHomeBanners: mocks.getHomeBanners,
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => ({
    ensureQueryData: mocks.ensureSystemFeatures,
  }),
}))

vi.mock('@/service/server', () => ({
  serverConsoleQuery: {
    systemFeatures: {
      get: {
        queryOptions: mocks.systemFeaturesQueryOptions,
      },
    },
  },
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
    mocks.ensureSystemFeatures.mockResolvedValue({ enable_explore_banner: true })
    mocks.systemFeaturesQueryOptions.mockReturnValue({
      queryKey: ['console', 'system-features', 'get'],
    })
    mocks.getHomeBanners.mockResolvedValue([])
  })

  it('skips the banner request but retains the greeting shell when the server feature gate is disabled', async () => {
    mocks.ensureSystemFeatures.mockResolvedValue({ enable_explore_banner: false })

    await renderHomeBanner()

    expect(mocks.getHomeBanners).not.toHaveBeenCalled()
    expect(screen.getByTestId('home-banner')).toHaveAttribute('data-banner-ids', '')
  })

  it('requests and renders banners when the server feature gate is enabled', async () => {
    mocks.getHomeBanners.mockResolvedValue([{ id: 'banner-1' }, { id: 'banner-2' }])

    await renderHomeBanner()

    expect(mocks.getHomeBanners).toHaveBeenCalledOnce()
    expect(screen.getByTestId('home-banner')).toHaveAttribute(
      'data-banner-ids',
      'banner-1,banner-2',
    )
    expect(screen.getByTestId('home-banner')).not.toHaveAttribute('data-reserves-carousel-space')
  })

  it('retains the greeting shell without reserving carousel space when the banner request fails', async () => {
    mocks.getHomeBanners.mockRejectedValue(new Error('Banner request failed'))

    await renderHomeBanner()

    expect(screen.getByTestId('home-banner')).toHaveAttribute('data-banner-ids', '')
    expect(screen.getByTestId('home-banner')).not.toHaveAttribute('data-reserves-carousel-space')
  })
})
