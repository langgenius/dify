import { renderHook } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import { useIsChatMode } from '../use-is-chat-mode'

const { mockStoreState } = vi.hoisted(() => ({
  mockStoreState: {
    appDetail: undefined as { mode?: AppModeEnum } | undefined,
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
}))

describe('useIsChatMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.appDetail = undefined
  })

  it('should return true when the app mode is ADVANCED_CHAT', () => {
    mockStoreState.appDetail = { mode: AppModeEnum.ADVANCED_CHAT }

    const { result } = renderHook(() => useIsChatMode())

    expect(result.current).toBe(true)
  })

  it('should return false when the app mode is not chat or app detail is missing', () => {
    mockStoreState.appDetail = { mode: AppModeEnum.WORKFLOW }

    const { result, rerender } = renderHook(() => useIsChatMode())

    expect(result.current).toBe(false)

    mockStoreState.appDetail = undefined
    rerender()

    expect(result.current).toBe(false)
  })
})
