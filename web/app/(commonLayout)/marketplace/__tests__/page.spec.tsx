import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
  it('does not stream async server children that Flight would double-resolve', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../page.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/const MarketplacePage = async/)
    expect(source).not.toContain('HydrateQueryClient')
  })

  it('renders the client marketplace home inside the install-permission provider', async () => {
    const { default: MarketplacePage } = await import('../page')
    render(<MarketplacePage />)

    const permission = screen.getByRole('region', { name: 'install permission' })

    expect(permission).toContainElement(screen.getByText('Embedded marketplace home'))
  })
})
