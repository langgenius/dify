import { fireEvent, render, screen } from '@testing-library/react'
import { PreferredProviderTypeEnum } from '../../../declarations'
import UsagePrioritySection from '../usage-priority-section'

describe('UsagePrioritySection', () => {
  const onSelect = vi.fn()
  const getAiCreditsButton = () => screen.getByRole('button', { name: /aiCreditsOption/ })
  const getApiKeyButton = () => screen.getByRole('button', { name: /apiKeyOption/ })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering
  describe('Rendering', () => {
    it('should render title and both option buttons', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      expect(screen.getByText(/usagePriority/))!.toBeInTheDocument()
      expect(getAiCreditsButton()).toBeInTheDocument()
      expect(getApiKeyButton()).toBeInTheDocument()
    })
  })

  // Selection state
  describe('Selection state', () => {
    it('should highlight AI credits option when value is credits', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      expect(getAiCreditsButton()).toHaveAttribute('aria-pressed', 'true')
      expect(getApiKeyButton()).toHaveAttribute('aria-pressed', 'false')
    })

    it('should highlight API key option when value is apiKey', () => {
      render(<UsagePrioritySection value="apiKey" onSelect={onSelect} />)

      expect(getAiCreditsButton()).toHaveAttribute('aria-pressed', 'false')
      expect(getApiKeyButton()).toHaveAttribute('aria-pressed', 'true')
    })

    it('should highlight API key option when value is apiKeyOnly', () => {
      render(<UsagePrioritySection value="apiKeyOnly" onSelect={onSelect} />)

      expect(getApiKeyButton()).toHaveAttribute('aria-pressed', 'true')
    })
  })

  // User interactions
  describe('User interactions', () => {
    it('should call onSelect with system when clicking AI credits option', () => {
      render(<UsagePrioritySection value="apiKey" onSelect={onSelect} />)

      fireEvent.click(getAiCreditsButton())

      expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.system)
    })

    it('should call onSelect with custom when clicking API key option', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      fireEvent.click(getApiKeyButton())

      expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.custom)
    })
  })
})
