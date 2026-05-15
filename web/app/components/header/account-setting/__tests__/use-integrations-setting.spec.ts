import { act, renderHook } from '@testing-library/react'
import { ACCOUNT_SETTING_TAB } from '../constants'
import { useIntegrationsSetting } from '../use-integrations-setting'

const { mockRouterPush, mockSetShowAccountSettingModal } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockSetShowAccountSettingModal: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

describe('useIntegrationsSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [ACCOUNT_SETTING_TAB.PROVIDER, '/integrations/model-provider'],
    [ACCOUNT_SETTING_TAB.DATA_SOURCE, '/integrations/data-source'],
    [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION, '/integrations/tools/api-extension'],
  ])('should navigate directly for migrated tab %s', (tab, destination) => {
    const { result } = renderHook(() => useIntegrationsSetting())

    act(() => {
      result.current({ payload: tab })
    })

    expect(mockRouterPush).toHaveBeenCalledWith(destination)
    expect(mockSetShowAccountSettingModal).not.toHaveBeenCalled()
  })

  it('should keep modal behavior for non-migrated tabs', () => {
    const { result } = renderHook(() => useIntegrationsSetting())

    act(() => {
      result.current({ payload: ACCOUNT_SETTING_TAB.BILLING })
    })

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.BILLING,
    })
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})
