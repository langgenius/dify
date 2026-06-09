import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OptionCard from '../option-card'

describe('OptionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The card should expose selection, child expansion, and readonly click behavior.
  describe('Interaction', () => {
    it('should call onClick with the card id and render active children', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()

      render(
        <OptionCard
          id="qualified"
          selectedId="qualified"
          title="High Quality"
          description="Use embedding retrieval."
          isRecommended
          enableRadio
          onClick={onClick}
        >
          <div>Advanced controls</div>
        </OptionCard>,
      )

      expect(screen.getByText('datasetCreation.stepTwo.recommend')).toBeInTheDocument()
      expect(screen.getByText('Advanced controls')).toBeInTheDocument()

      await user.click(screen.getByText('High Quality'))

      expect(onClick).toHaveBeenCalledWith('qualified')
    })

    it('should not trigger selection when the card is readonly', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()

      render(
        <OptionCard
          id="economical"
          title="Economical"
          readonly
          onClick={onClick}
        />,
      )

      await user.click(screen.getByText('Economical'))

      expect(onClick).not.toHaveBeenCalled()
    })

    it('should support function-based wrapper, class, and icon props without enabling selection', () => {
      render(
        <OptionCard
          id="inactive"
          selectedId="qualified"
          title="Inactive card"
          enableSelect={false}
          wrapperClassName={isActive => (isActive ? 'wrapper-active' : 'wrapper-inactive')}
          className={isActive => (isActive ? 'body-active' : 'body-inactive')}
          icon={isActive => <span data-testid="option-icon">{isActive ? 'active' : 'inactive'}</span>}
        />,
      )

      expect(screen.getByText('Inactive card').closest('.wrapper-inactive')).toBeInTheDocument()
      expect(screen.getByTestId('option-icon')).toHaveTextContent('inactive')
      expect(screen.getByText('Inactive card').closest('.body-inactive')).toBeInTheDocument()
    })
  })
})
