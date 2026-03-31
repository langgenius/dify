import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import CreditsExhaustedAlert from '../credits-exhausted-alert'

const mockTrialCredits = { credits: 0, totalCredits: 10_000, isExhausted: true, isLoading: false, nextCreditResetDate: undefined }
const mockSetShowPricingModal = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    Trans: ({
      i18nKey,
      components,
    }: {
      i18nKey?: string
      components: { upgradeLink: ReactNode }
    }) => (
      <>
        {i18nKey}
        {components.upgradeLink}
      </>
    ),
  }
})

vi.mock('../../use-trial-credits', () => ({
  useTrialCredits: () => mockTrialCredits,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: () => mockSetShowPricingModal,
}))

describe('CreditsExhaustedAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mockTrialCredits, { credits: 0, totalCredits: 10_000 })
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

    it('should cap progress at 100 percent when total credits are zero', () => {
      Object.assign(mockTrialCredits, { credits: 0, totalCredits: 0 })

      const { container } = render(<CreditsExhaustedAlert hasApiKeyFallback={false} />)

      expect(container.querySelector('.bg-components-progress-error-progress')).toHaveStyle({ width: '100%' })
    })

    it('should open the pricing modal when the upgrade link is clicked', () => {
      const { container } = render(<CreditsExhaustedAlert hasApiKeyFallback={false} />)

      fireEvent.click(container.querySelector('button') as HTMLButtonElement)

      expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
    })
  })
})
