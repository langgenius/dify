import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum } from '../../types'
import CategoryEmptyState from '../category-empty-state'
import { getCategoryMarketplaceId } from '../category-marketplace'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...createReactI18nextMock(),
    Trans: ({ components }: { components: { marketplace: ReactNode } }) => (
      <>You can install integrations from the {components.marketplace}.</>
    ),
  }
})

describe('CategoryEmptyState', () => {
  it.each([
    [PluginCategoryEnum.trigger, 'plugin.list.noTriggerFound'],
    [PluginCategoryEnum.agent, 'plugin.list.noAgentStrategyFound'],
    [PluginCategoryEnum.extension, 'plugin.list.noExtensionFound'],
  ] as const)(
    'renders the compact %s empty state with an embedded marketplace link',
    (category, label) => {
      render(<CategoryEmptyState category={category} showMarketplaceLink />)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(/You can install integrations from the/)).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' }),
      ).toHaveAttribute('href', `#${getCategoryMarketplaceId(category)}`)
    },
  )

  it('removes the middle install entry when marketplace is disabled', () => {
    render(<CategoryEmptyState category={PluginCategoryEnum.trigger} showMarketplaceLink={false} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.source.github')).not.toBeInTheDocument()
    expect(screen.queryByText('plugin.source.local')).not.toBeInTheDocument()
  })
})
