import { renderHook } from '@testing-library/react'
import { useLanguage } from './hooks'
import { useContext } from 'use-context-selector'
import { after } from 'node:test'

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(() => ({
    invalidateQueries: jest.fn(),
  })),
}))

// mock use-context-selector
jest.mock('use-context-selector', () => ({
  useContext: jest.fn(),
  createContext: () => ({
    Provider: ({ children }: any) => children,
    Consumer: ({ children }: any) => children(null),
  }),
  useContextSelector: jest.fn(),
}))

// mock service/common functions
jest.mock('@/service/common', () => ({
  fetchDefaultModal: jest.fn(),
  fetchModelList: jest.fn(),
  fetchModelProviderCredentials: jest.fn(),
  getPayUrl: jest.fn(),
}))

jest.mock('@/service/use-common', () => ({
  commonQueryKeys: {
    modelProviders: ['common', 'model-providers'],
  },
}))

// mock context hooks
jest.mock('@/context/i18n', () => ({
  __esModule: true,
  default: jest.fn(),
}))

jest.mock('@/context/provider-context', () => ({
  useProviderContext: jest.fn(),
}))

jest.mock('@/context/modal-context', () => ({
  useModalContextSelector: jest.fn(),
}))

jest.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: jest.fn(),
}))

// mock plugins
jest.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: jest.fn(),
}))

jest.mock('@/app/components/plugins/marketplace/utils', () => ({
  getMarketplacePluginsByCollectionId: jest.fn(),
}))

jest.mock('./provider-added-card', () => jest.fn())

after(() => {
  jest.resetModules()
  jest.clearAllMocks()
})

describe('useLanguage', () => {
  it('should replace hyphen with underscore in locale', () => {
    (useContext as jest.Mock).mockReturnValue({
      locale: 'en-US',
    })
    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('en_US')
  })

  it('should return locale as is if no hyphen exists', () => {
    (useContext as jest.Mock).mockReturnValue({
      locale: 'enUS',
    })

    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('enUS')
  })

  it('should handle multiple hyphens', () => {
    // Mock the I18n context return value
    (useContext as jest.Mock).mockReturnValue({
      locale: 'zh-Hans-CN',
    })

    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('zh_Hans-CN')
  })
})
