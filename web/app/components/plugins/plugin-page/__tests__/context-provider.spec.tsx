import { fireEvent, render, screen } from '@testing-library/react'
import { useQueryState } from 'nuqs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { usePluginPageContext } from '../context'
import { PluginPageContextProvider } from '../context-provider'

vi.mock('nuqs', () => ({
  parseAsStringEnum: vi.fn(() => ({
    withDefault: vi.fn(() => ({})),
  })),
  useQueryState: vi.fn(() => ['plugins', vi.fn()]),
}))

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
    vi.mocked(useQueryState).mockReturnValue(['plugins', vi.fn()])
  })

  it('filters out the marketplace tab when the feature is disabled', () => {
    mockGlobalPublicStore(false)

    render(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
    )

    expect(screen.getByTestId('options-count')).toHaveTextContent('1')
  })

  it('keeps the query-state tab and updates the current plugin id', () => {
    mockGlobalPublicStore(true)
    vi.mocked(useQueryState).mockReturnValue(['discover', vi.fn()])

    render(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
    )

    fireEvent.click(screen.getByText('select plugin'))

    expect(screen.getByTestId('current-plugin')).toHaveTextContent('plugin-1')
    expect(screen.getByTestId('options-count')).toHaveTextContent('2')
  })
})
