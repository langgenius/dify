import { fireEvent, render, screen } from '@testing-library/react'
import { PreferredProviderTypeEnum } from '../../../declarations'
import UsagePrioritySection from '../usage-priority-section'

describe('UsagePrioritySection', () => {
  const onSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering
  describe('Rendering', () => {
    it('should render title and both option buttons', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      expect(screen.getByText(/usagePriority/)).toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(2)
    })
  })

  // Selection state
  describe('Selection state', () => {
    it('should highlight AI credits option when value is credits', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons[0].className).toContain('border-components-option-card-option-selected-border')
      expect(buttons[1].className).not.toContain('border-components-option-card-option-selected-border')
    })

    it('should highlight API key option when value is apiKey', () => {
      render(<UsagePrioritySection value="apiKey" onSelect={onSelect} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons[0].className).not.toContain('border-components-option-card-option-selected-border')
      expect(buttons[1].className).toContain('border-components-option-card-option-selected-border')
    })

    it('should highlight API key option when value is apiKeyOnly', () => {
      render(<UsagePrioritySection value="apiKeyOnly" onSelect={onSelect} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons[1].className).toContain('border-components-option-card-option-selected-border')
    })
  })

  // User interactions
  describe('User interactions', () => {
    it('should call onSelect with system when clicking AI credits option', () => {
      render(<UsagePrioritySection value="apiKey" onSelect={onSelect} />)

      fireEvent.click(screen.getAllByRole('button')[0])

      expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.system)
    })

    it('should call onSelect with custom when clicking API key option', () => {
      render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

      fireEvent.click(screen.getAllByRole('button')[1])

      expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.custom)
    })
  })
})
