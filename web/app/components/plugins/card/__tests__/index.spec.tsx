import { render, screen } from '@testing-library/react'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import Card from '../index'

it('renders a Marketplace card without workspace providers, even for a non-marketplace source', () => {
  const plugin = createMarketplacePluginFixture({
    org: 'langgenius',
    name: 'demo-plugin',
    from: 'github',
    label: { en_US: 'Marketplace plugin' },
  })

  // Independent Marketplace has no Console Query or workspace provider.
  render(<Card payload={plugin} variant="marketplace" />)

  expect(screen.getByText('Marketplace plugin')).toBeInTheDocument()
  expect(screen.getByRole('presentation')).toHaveAttribute(
    'src',
    `${MARKETPLACE_API_PREFIX}/plugins/langgenius/demo-plugin/icon`,
  )
  // This namespace is available on standalone Marketplace; tools.author is not.
  expect(screen.getByText('plugin.marketplace.by')).toBeInTheDocument()
  expect(screen.getByText('langgenius')).toBeInTheDocument()
})
