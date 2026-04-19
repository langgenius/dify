import { fireEvent, render, screen } from '@testing-library/react'
import { PreferredProviderTypeEnum } from '../../../declarations'
import UsagePrioritySection from '../usage-priority-section'

const AI_CREDITS_BUTTON_NAME = 'common.modelProvider.card.aiCreditsOption'
const API_KEY_BUTTON_NAME = 'common.modelProvider.card.apiKeyOption'

describe('UsagePrioritySection', () => {
  const onSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering
  describe('Rendering', () => {
    it('should render title and both option buttons', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      expect(screen.getByText(/usagePriority/))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: AI_CREDITS_BUTTON_NAME })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: API_KEY_BUTTON_NAME })).toBeInTheDocument()
    })
  })

  // Selection state
  describe('Selection state', () => {
    it('should highlight AI credits option when value is credits', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      const aiCredits = screen.getByRole('button', { name: AI_CREDITS_BUTTON_NAME })
      const apiKey = screen.getByRole('button', { name: API_KEY_BUTTON_NAME })
      expect(aiCredits.className).toContain('border-components-option-card-option-selected-border')
      expect(apiKey.className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should highlight API key option when value is apiKey', () => {
      render(<UsagePrioritySection value="apiKey" onSelect={onSelect} />)

      const aiCredits = screen.getByRole('button', { name: AI_CREDITS_BUTTON_NAME })
      const apiKey = screen.getByRole('button', { name: API_KEY_BUTTON_NAME })
      expect(aiCredits.className).not.toContain('border-components-option-card-option-selected-border')
      expect(apiKey.className).toContain('border-components-option-card-option-selected-border')
    })

    it('should highlight API key option when value is apiKeyOnly', () => {
      render(<UsagePrioritySection value="apiKeyOnly" onSelect={onSelect} />)

      const apiKey = screen.getByRole('button', { name: API_KEY_BUTTON_NAME })
      expect(apiKey.className).toContain('border-components-option-card-option-selected-border')
    })
  })

  // User interactions
  describe('User interactions', () => {
    it('should call onSelect with system when clicking AI credits option', () => {
      render(<UsagePrioritySection value="apiKey" onSelect={onSelect} />)

      fireEvent.click(screen.getByRole('button', { name: AI_CREDITS_BUTTON_NAME }))

      expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.system)
    })

    it('should call onSelect with custom when clicking API key option', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      fireEvent.click(screen.getByRole('button', { name: API_KEY_BUTTON_NAME }))

      expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.custom)
    })
  })
})
