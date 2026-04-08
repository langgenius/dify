import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { usePluginPageContext } from '../context'
import { PluginPageContextProvider } from '../context-provider'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

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

const mockGlobalPublicStore = (enableMarketplace: boolean) => {
  vi.mocked(useGlobalPublicStore).mockImplementation((selector) => {
    const state = { systemFeatures: { enable_marketplace: enableMarketplace } }
    return selector(state as Parameters<typeof selector>[0])
  })
}

const Consumer = () => {
  const currentPluginID = usePluginPageContext(v => v.currentPluginID)
  const setCurrentPluginID = usePluginPageContext(v => v.setCurrentPluginID)
  const options = usePluginPageContext(v => v.options)

  return (
    <div>
      <span data-testid="current-plugin">{currentPluginID ?? 'none'}</span>
      <span data-testid="options-count">{options.length}</span>
      <button onClick={() => setCurrentPluginID('plugin-1')}>select plugin</button>
    </div>
  )
}

describe('PluginPageContextProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters out the marketplace tab when the feature is disabled', () => {
    mockGlobalPublicStore(false)

    renderWithNuqs(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
    )

    expect(screen.getByTestId('options-count')).toHaveTextContent('1')
  })

  it('keeps the query-state tab and updates the current plugin id', () => {
    mockGlobalPublicStore(true)

    renderWithNuqs(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
      { searchParams: '?tab=discover' },
    )

    fireEvent.click(screen.getByText('select plugin'))

    expect(screen.getByTestId('current-plugin')).toHaveTextContent('plugin-1')
    expect(screen.getByTestId('options-count')).toHaveTextContent('2')
  })
})
