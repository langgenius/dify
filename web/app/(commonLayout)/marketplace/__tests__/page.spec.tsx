import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchPluginBanners, mockGetLocaleOnServer } = vi.hoisted(() => ({
  mockFetchPluginBanners: vi.fn(),
  mockGetLocaleOnServer: vi.fn(),
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: mockGetLocaleOnServer,
}))

vi.mock('@/app/components/plugins/marketplace/home/banners', () => ({
  fetchPluginBanners: mockFetchPluginBanners,
}))

vi.mock('@/app/components/plugins/marketplace/hydration-server', () => ({
  HydrateQueryClient: ({ children }: { children: ReactNode }) => (
    <section aria-label="marketplace hydration">{children}</section>
  ),
}))

vi.mock('@/app/components/plugins/marketplace/marketplace-install-permission-provider', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <section aria-label="install permission">{children}</section>
  ),
}))

vi.mock('@/app/components/plugins/marketplace/embedded', () => ({
  EmbeddedMarketplace: () => <p>Embedded marketplace home</p>,
}))

vi.mock('@/app/components/main-nav/components/account-section', () => ({
  default: () => null,
}))

describe('embedded marketplace home route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLocaleOnServer.mockResolvedValue('en-US')
    mockFetchPluginBanners.mockResolvedValue([])
  })

  it('keeps the client install-permission provider inside server hydration', async () => {
    const { default: MarketplacePage } = await import('../page')
    render(await MarketplacePage({}))

    const hydration = screen.getByRole('region', { name: 'marketplace hydration' })
    const permission = screen.getByRole('region', { name: 'install permission' })

    expect(hydration).toContainElement(permission)
    expect(screen.getByText('Embedded marketplace home')).toBeInTheDocument()
  })
})
