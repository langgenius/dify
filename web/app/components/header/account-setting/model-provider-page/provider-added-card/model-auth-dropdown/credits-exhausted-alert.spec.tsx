import { render, screen } from '@testing-library/react'
import CreditsExhaustedAlert from './credits-exhausted-alert'

const mockTrialCredits = { credits: 0, totalCredits: 10_000, isExhausted: true, isLoading: false, nextCreditResetDate: undefined }

vi.mock('../use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

describe('CreditsExhaustedAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mockTrialCredits, { credits: 0 })
  })

  // Without API key fallback
  describe('Without API key fallback', () => {
    it('should show exhausted message', () => {
      render(<CreditsExhaustedAlert hasApiKeyFallback={false} />)

      expect(screen.getByText(/creditsExhaustedMessage/)).toBeInTheDocument()
    })

    it('should show description with upgrade link', () => {
      render(<CreditsExhaustedAlert hasApiKeyFallback={false} />)

      expect(screen.getByText(/creditsExhaustedDescription/)).toBeInTheDocument()
    })
  })

  // With API key fallback
  describe('With API key fallback', () => {
    it('should show fallback message', () => {
      render(<CreditsExhaustedAlert hasApiKeyFallback />)

      expect(screen.getByText(/creditsExhaustedFallback(?!Description)/)).toBeInTheDocument()
    })

    it('should show fallback description', () => {
      render(<CreditsExhaustedAlert hasApiKeyFallback />)

      expect(screen.getByText(/creditsExhaustedFallbackDescription/)).toBeInTheDocument()
    })
  })

  // Usage display
  describe('Usage display', () => {
    it('should show usage label', () => {
      render(<CreditsExhaustedAlert hasApiKeyFallback={false} />)

      expect(screen.getByText(/usageLabel/)).toBeInTheDocument()
    })

    it('should show usage amounts', () => {
      mockTrialCredits.credits = 200

      render(<CreditsExhaustedAlert hasApiKeyFallback={false} />)

      expect(screen.getByText(/9,800/)).toBeInTheDocument()
      expect(screen.getByText(/10,000/)).toBeInTheDocument()
    })
  })
})
