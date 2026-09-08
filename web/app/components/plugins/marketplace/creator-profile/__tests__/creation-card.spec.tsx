import type { CreatorCreation } from '../model'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CreationCard from '../creation-card'

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <span data-testid="creation-icon" />,
}))

const creation: CreatorCreation = {
  id: 'plugin:dify/search',
  kind: 'plugin',
  title: 'Search',
  description: 'Search the web.',
  target: { type: 'plugin', pluginType: 'plugin', org: 'dify', name: 'search' },
  icon: { type: 'emoji', value: '🔎' },
  dependencyIcons: ['/one.png', '/two.png'],
  dependencyCount: 4,
  updatedAt: 1,
  createdAt: 1,
  popularity: 1,
}

describe('CreationCard', () => {
  it('renders a host link without selecting', () => {
    render(
      <CreationCard
        creation={creation}
        action={{ type: 'link', href: '/plugin/dify/search?language=en-US' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute(
      'href',
      '/plugin/dify/search?language=en-US',
    )
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('selects in Dify without rendering a navigation target', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<CreationCard creation={creation} action={{ type: 'select', onSelect }} />)

    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
