import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
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
  const { wrapper: ConsoleQueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { enable_marketplace: options.enableMarketplace },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ConsoleQueryWrapper>
      <NuqsTestingAdapter searchParams={options.searchParams ?? ''}>{children}</NuqsTestingAdapter>
    </ConsoleQueryWrapper>
  )
  return render(ui, { wrapper: Wrapper })
}

const Consumer = () => {
  const selectedItem = usePluginPageContext((v) => v.selectedItem)
  const setSelectedItem = usePluginPageContext((v) => v.setSelectedItem)
  const options = usePluginPageContext((v) => v.options)

  return (
    <div>
      <output aria-label="Selected item">
        {selectedItem ? `${selectedItem.type}:${selectedItem.id}` : 'none'}
      </output>
      <output aria-label="Available tabs">{options.length}</output>
      <button onClick={() => setSelectedItem({ type: 'builtinTool', id: 'builtin-1' })}>
        select builtin tool
      </button>
      <button onClick={() => setSelectedItem({ type: 'plugin', id: 'plugin-1' })}>
        select plugin
      </button>
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

  it('keeps the query-state tab and replaces the selected item', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <PluginPageContextProvider>
        <Consumer />
      </PluginPageContextProvider>,
      { enableMarketplace: true, searchParams: '?tab=discover' },
    )

    await user.click(screen.getByRole('button', { name: 'select builtin tool' }))

    expect(screen.getByRole('status', { name: 'Selected item' })).toHaveTextContent(
      'builtinTool:builtin-1',
    )

    await user.click(screen.getByRole('button', { name: 'select plugin' }))

    expect(screen.getByRole('status', { name: 'Selected item' })).toHaveTextContent(
      'plugin:plugin-1',
    )
    expect(screen.getByRole('status', { name: 'Available tabs' })).toHaveTextContent('2')
  })
})
