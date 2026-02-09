import { fireEvent, render, screen } from '@testing-library/react'
import ActionCard from './action-card'

describe('ActionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render icon, title, and description when props are provided', () => {
      render(
        <ActionCard
          icon={<span data-testid="action-card-icon">i</span>}
          title="Create skill"
          description="Create a new skill from scratch"
        />,
      )

      expect(screen.getByRole('button', { name: /create skill/i })).toBeInTheDocument()
      expect(screen.getByText('Create a new skill from scratch')).toBeInTheDocument()
      expect(screen.getByTestId('action-card-icon')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onClick when the card is clicked', () => {
      const onClick = vi.fn()
      render(
        <ActionCard
          icon={<span>i</span>}
          title="Import skill"
          description="Import from zip"
          onClick={onClick}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /import skill/i }))

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should stay enabled when onClick is not provided', () => {
      render(
        <ActionCard
          icon={<span>i</span>}
          title="No handler"
          description="Card without click handler"
        />,
      )

      const button = screen.getByRole('button', { name: /no handler/i })
      expect(button).toBeEnabled()
      expect(() => fireEvent.click(button)).not.toThrow()
    })
  })
})
