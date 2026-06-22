import { act, renderHook } from '@testing-library/react'
import { ACCOUNT_SETTING_TAB } from '../constants'
import { useIntegrationsSetting } from '../use-integrations-setting'

const { mockSetShowAccountSettingModal } = vi.hoisted(() => ({
  mockSetShowAccountSettingModal: vi.fn(),
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
    [ACCOUNT_SETTING_TAB.PROVIDER, 'provider'],
    [ACCOUNT_SETTING_TAB.DATA_SOURCE, 'data-source'],
    [ACCOUNT_SETTING_TAB.API_BASED_EXTENSION, 'custom-endpoint'],
  ])('should open integrations settings for migrated tab %s', (tab, section) => {
    const { result } = renderHook(() => useIntegrationsSetting())

    act(() => {
      result.current({ payload: tab })
    })

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: section })
  })

  it('should open integrations settings from a direct section', () => {
    const { result } = renderHook(() => useIntegrationsSetting())

    act(() => {
      result.current({ section: 'mcp' })
    })

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'mcp' })
  })

  it('should preserve the agent source for agent-scoped settings', () => {
    const { result } = renderHook(() => useIntegrationsSetting())

    act(() => {
      result.current({ payload: ACCOUNT_SETTING_TAB.PROVIDER, source: 'agent' })
    })

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'provider', source: 'agent' })
  })

  it('should preserve the cancel callback for migrated integrations settings', () => {
    const onCancelCallback = vi.fn()
    const { result } = renderHook(() => useIntegrationsSetting())

    act(() => {
      result.current({ payload: ACCOUNT_SETTING_TAB.PROVIDER, onCancelCallback })
    })

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'provider', onCancelCallback })
  })
})
