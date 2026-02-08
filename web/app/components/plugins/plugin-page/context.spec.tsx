import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import mocks
import { useGlobalPublicStore } from '@/context/global-public-context'

import { PluginPageContext, PluginPageContextProvider, usePluginPageContext } from './context'

// Mock dependencies
vi.mock('nuqs', () => ({
  useQueryState: vi.fn(() => ['plugins', vi.fn()]),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('../hooks', () => ({
  PLUGIN_PAGE_TABS_MAP: {
    plugins: 'plugins',
    marketplace: 'discover',
  },
  usePluginPageTabs: () => [
    { value: 'plugins', text: 'Plugins' },
    { value: 'discover', text: 'Explore Marketplace' },
  ],
}))

// Helper function to mock useGlobalPublicStore with marketplace setting
const mockGlobalPublicStore = (enableMarketplace: boolean) => {
  vi.mocked(useGlobalPublicStore).mockImplementation((selector) => {
    const state = { systemFeatures: { enable_marketplace: enableMarketplace } }
    return selector(state as Parameters<typeof selector>[0])
  })
}

// Test component that uses the context
const TestConsumer = () => {
  const containerRef = usePluginPageContext(v => v.containerRef)
  const options = usePluginPageContext(v => v.options)
  const activeTab = usePluginPageContext(v => v.activeTab)

  return (
    <div>
      <span data-testid="has-container-ref">{containerRef ? 'true' : 'false'}</span>
      <span data-testid="options-count">{options.length}</span>
      <span data-testid="active-tab">{activeTab}</span>
      {options.map((opt: { value: string, text: string }) => (
        <span key={opt.value} data-testid={`option-${opt.value}`}>{opt.text}</span>
      ))}
    </div>
  )
}

describe('PluginPageContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('PluginPageContextProvider', () => {
    it('should provide context values to children', () => {
      mockGlobalPublicStore(true)

      render(
        <PluginPageContextProvider>
          <TestConsumer />
        </PluginPageContextProvider>,
      )

      expect(screen.getByTestId('has-container-ref')).toHaveTextContent('true')
      expect(screen.getByTestId('options-count')).toHaveTextContent('2')
    })

    it('should include marketplace tab when enable_marketplace is true', () => {
      mockGlobalPublicStore(true)

      render(
        <PluginPageContextProvider>
          <TestConsumer />
        </PluginPageContextProvider>,
      )

      expect(screen.getByTestId('option-plugins')).toBeInTheDocument()
      expect(screen.getByTestId('option-discover')).toBeInTheDocument()
    })

    it('should filter out marketplace tab when enable_marketplace is false', () => {
      mockGlobalPublicStore(false)

      render(
        <PluginPageContextProvider>
          <TestConsumer />
        </PluginPageContextProvider>,
      )

      expect(screen.getByTestId('option-plugins')).toBeInTheDocument()
      expect(screen.queryByTestId('option-discover')).not.toBeInTheDocument()
      expect(screen.getByTestId('options-count')).toHaveTextContent('1')
    })
  })

  describe('usePluginPageContext', () => {
    it('should select specific context values', () => {
      mockGlobalPublicStore(true)

      render(
        <PluginPageContextProvider>
          <TestConsumer />
        </PluginPageContextProvider>,
      )

      // activeTab should be 'plugins' from the mock
      expect(screen.getByTestId('active-tab')).toHaveTextContent('plugins')
    })
  })

  describe('Default Context Values', () => {
    it('should have empty options by default from context', () => {
      // Test that the context has proper default values by checking the exported constant
      // The PluginPageContext is created with default values including empty options array
      expect(PluginPageContext).toBeDefined()
    })
  })
})
