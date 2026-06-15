import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarketplacePage from '../page'

vi.mock('@/app/components/plugins/marketplace', () => ({
  default: ({ showInstallButton }: { showInstallButton?: boolean }) => (
    <div data-show-install={String(showInstallButton ?? true)}>Marketplace</div>
  ),
}))

describe('MarketplacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should keep marketplace card install actions enabled', () => {
      render(<MarketplacePage />)

      expect(screen.getByText('Marketplace')).toHaveAttribute('data-show-install', 'true')
    })
  })
})
