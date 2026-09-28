import { cleanup, screen } from '@testing-library/react'
import {
  clearAllMocks,
  interactions,
  mockSetSettingsDestination,
  scenarios,
  setDeploymentEdition,
  textKeys,
} from './test-utils'

afterEach(cleanup)

describe('APIKeyInfoPanel - Community Edition', () => {
  beforeEach(() => {
    clearAllMocks()
    setDeploymentEdition('COMMUNITY')
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
