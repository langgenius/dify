import { renderHook } from '@testing-library/react'
import { useLanguage } from './hooks'
import { useContext } from 'use-context-selector'
import { after } from 'node:test'

vi.mock('swr', () => ({
  __esModule: true,
  default: vi.fn(), // mock useSWR
  useSWRConfig: vi.fn(),
}))

// mock use-context-selector
vi.mock('use-context-selector', () => ({
  useContext: vi.fn(),
}))

// mock service/common functions
vi.mock('@/service/common', () => ({
  fetchDefaultModal: vi.fn(),
  fetchModelList: vi.fn(),
  fetchModelProviderCredentials: vi.fn(),
  fetchModelProviders: vi.fn(),
  getPayUrl: vi.fn(),
}))

// mock context hooks
vi.mock('@/context/i18n', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(),
}))

// mock plugins
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/utils', () => ({
  getMarketplacePluginsByCollectionId: vi.fn(),
}))

vi.mock('./provider-added-card', () => ({
  default: vi.fn(),
}))

after(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('useLanguage', () => {
  it('should replace hyphen with underscore in locale', () => {
    (useContext as vi.Mock).mockReturnValue({
      locale: 'en-US',
    })
    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('en_US')
  })

  it('should return locale as is if no hyphen exists', () => {
    (useContext as vi.Mock).mockReturnValue({
      locale: 'enUS',
    })

    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('enUS')
  })

  it('should handle multiple hyphens', () => {
    // Mock the I18n context return value
    (useContext as vi.Mock).mockReturnValue({
      locale: 'zh-Hans-CN',
    })

    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('zh_Hans-CN')
  })
})
