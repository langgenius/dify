import type { ReactElement, ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystemFeaturesWrapper } from '@/__tests__/utils/mock-system-features'
import { usePluginPageContext } from '../context'
import { PluginPageContextProvider } from '../context-provider'

vi.mock('../../hooks', () => ({
  PLUGIN_PAGE_TABS_MAP: {
    plugins: 'plugins',
    marketplace: 'discover',
  },
  usePluginPageTabs: () => [
    { value: 'plugins', text: 'Plugins' },
    { value: 'discover', text: 'Discover' },
  ],
}))

const renderWithProviders = (
  ui: ReactElement,
  options: { enableMarketplace: boolean; searchParams?: string } = { enableMarketplace: true },
) => {
  const { wrapper: SystemFeaturesWrapper } = createSystemFeaturesWrapper({
    systemFeatures: { enable_marketplace: options.enableMarketplace },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SystemFeaturesWrapper>
      <NuqsTestingAdapter searchParams={options.searchParams ?? ''}>{children}</NuqsTestingAdapter>
    </SystemFeaturesWrapper>
  )
  return render(ui, { wrapper: Wrapper })
}

const Consumer = () => {
  const currentPluginID = usePluginPageContext((v) => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext((v) => v.setCurrentPluginID)
  const options = usePluginPageContext((v) => v.options)

  return (
    <div>
      <output aria-label="Current plugin">{currentPluginID ?? 'none'}</output>
      <output aria-label="Available tabs">{options.length}</output>
      <button onClick={() => setCurrentPluginID('plugin-1')}>select plugin</button>
    </div>
  )
}

describe('PluginPageContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out the marketplace tab when the feature is disabled', () => {
    renderWithProviders(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
      { enableMarketplace: false },
    )

    expect(screen.getByRole('status', { name: 'Available tabs' })).toHaveTextContent('1')
  })

  it('keeps the query-state tab and updates the current plugin id', () => {
    renderWithProviders(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
      { enableMarketplace: true, searchParams: '?tab=discover' },
    )

    fireEvent.click(screen.getByText('select plugin'))

    expect(screen.getByRole('status', { name: 'Current plugin' })).toHaveTextContent('plugin-1')
    expect(screen.getByRole('status', { name: 'Available tabs' })).toHaveTextContent('2')
  })
})
