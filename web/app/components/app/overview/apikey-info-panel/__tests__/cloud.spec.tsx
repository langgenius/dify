import { cleanup, screen } from '@testing-library/react'
import {
  clearAllMocks,
  interactions,
  mockSetSettingsDestination,
  scenarios,
  setDeploymentEdition,
} from './test-utils'

afterEach(cleanup)

describe('APIKeyInfoPanel - Cloud Edition', () => {
  beforeEach(() => {
    clearAllMocks()
    setDeploymentEdition('CLOUD')
  })

  it('hides the panel when an API key already exists', () => {
    const { container } = scenarios.withAPIKeySet()
    expect(container).toBeEmptyDOMElement()
  })

  it('opens provider settings from the primary action', () => {
    scenarios.withAPIKeyNotSet()
    interactions.clickMainButton()
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('provider')
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
