import { cleanup, screen } from '@testing-library/react'
import {
  clearAllMocks,
  defaultModalContext,
  interactions,
  mockUseModalContext,
  scenarios,
  textKeys,
} from './test-utils'

vi.mock('@/config', () => ({ IS_CE_EDITION: true }))

afterEach(cleanup)

describe('APIKeyInfoPanel - Community Edition', () => {
  const setShowAccountSettingModal = vi.fn()

  beforeEach(() => {
    clearAllMocks()
    mockUseModalContext.mockReturnValue({
      ...defaultModalContext,
      setShowAccountSettingModal,
    })
  })

  it('hides the panel when an API key already exists', () => {
    const { container } = scenarios.withAPIKeySet()
    expect(container).toBeEmptyDOMElement()
  })

  it('opens provider settings from the primary action', () => {
    scenarios.withMockModal(setShowAccountSettingModal)
    interactions.clickMainButton()
    expect(setShowAccountSettingModal).toHaveBeenCalledWith({ payload: 'provider' })
  })

  it('links self-hosted users to Dify Cloud safely', () => {
    scenarios.withAPIKeyNotSet()
    expect(screen.getByRole('link', { name: textKeys.selfHost.tryCloud })).toMatchObject({
      target: '_blank',
      rel: 'noopener noreferrer',
    })
  })

  it('dismisses the panel from the close action', () => {
    const { container } = scenarios.withAPIKeyNotSet()
    interactions.clickCloseButton(container)
    expect(container).toBeEmptyDOMElement()
  })
})
