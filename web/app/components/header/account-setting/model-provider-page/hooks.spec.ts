import type { Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLocale } from '@/context/i18n'
import { useLanguage } from './hooks'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

// mock use-context-selector
vi.mock('use-context-selector', () => ({
  useContext: vi.fn(),
  createContext: () => ({
    Provider: ({ children }: any) => children,
    Consumer: ({ children }: any) => children(null),
  }),
  useContextSelector: vi.fn(),
}))

// mock service/common functions
vi.mock('@/service/common', () => ({
  fetchDefaultModal: vi.fn(),
  fetchModelList: vi.fn(),
  fetchModelProviderCredentials: vi.fn(),
  getPayUrl: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: {
    modelProviders: ['common', 'model-providers'],
  },
}))

// mock context hooks
vi.mock('@/context/i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
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

afterAll(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('useLanguage', () => {
  it('should replace hyphen with underscore in locale', () => {
    ;(useLocale as Mock).mockReturnValue('en-US')
    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('en_US')
  })

  it('should return locale as is if no hyphen exists', () => {
    ;(useLocale as Mock).mockReturnValue('enUS')

    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('enUS')
  })

  it('should handle multiple hyphens', () => {
    ;(useLocale as Mock).mockReturnValue('zh-Hans-CN')

    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('zh_Hans-CN')
  })
})
