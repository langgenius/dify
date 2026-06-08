import { render, screen } from '@testing-library/react'
import CreditsFallbackAlert from '../credits-fallback-alert'

describe('CreditsFallbackAlert', () => {
  it('should render the credential fallback copy and description when credentials exist', () => {
    render(<CreditsFallbackAlert hasCredentials />)

    expect(screen.getByText('common.modelProvider.card.apiKeyUnavailableFallback')).toBeInTheDocument()
    expect(screen.getByText('common.modelProvider.card.apiKeyUnavailableFallbackDescription')).toBeInTheDocument()
  })

  it('should render the no-credentials fallback copy without the description', () => {
    render(<CreditsFallbackAlert hasCredentials={false} />)

    expect(screen.getByText('common.modelProvider.card.noApiKeysFallback')).toBeInTheDocument()
    expect(screen.queryByText('common.modelProvider.card.apiKeyUnavailableFallbackDescription')).not.toBeInTheDocument()
  })
})
