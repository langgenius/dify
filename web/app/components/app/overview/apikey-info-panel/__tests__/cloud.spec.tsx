import { cleanup, screen } from '@testing-library/react'
import {
  clearAllMocks,
  defaultModalContext,
  interactions,
  mockUseModalContext,
  scenarios,
} from './test-utils'

vi.mock('@/config', () => ({ IS_CE_EDITION: false }))

afterEach(cleanup)

describe('APIKeyInfoPanel - Cloud Edition', () => {
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

  it('does not show the self-hosted Cloud link', () => {
    scenarios.withAPIKeyNotSet()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('dismisses the panel from the close action', () => {
    const { container } = scenarios.withAPIKeyNotSet()
    interactions.clickCloseButton(container)
    expect(container).toBeEmptyDOMElement()
  })
})
