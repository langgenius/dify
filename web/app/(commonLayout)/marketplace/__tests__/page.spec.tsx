import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
  it('stays a sync server module so Flight does not double-resolve the marketplace segment', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../page.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/const MarketplacePage = async/)
  })

  it('keeps the client install-permission provider inside server hydration', async () => {
    const { default: MarketplacePage } = await import('../page')
    render(MarketplacePage({}))

    const hydration = screen.getByRole('region', { name: 'marketplace hydration' })
    const permission = screen.getByRole('region', { name: 'install permission' })

    expect(hydration).toContainElement(permission)
    expect(screen.getByText('Embedded marketplace home')).toBeInTheDocument()
  })
})
