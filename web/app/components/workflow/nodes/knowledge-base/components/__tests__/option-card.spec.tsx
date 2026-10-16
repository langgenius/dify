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

      render(<OptionCard id="economical" title="Economical" readonly onClick={onClick} />)

      await user.click(screen.getByText('Economical'))

      expect(onClick).not.toHaveBeenCalled()
    })

    it('should expose selection to keyboard users while keeping expanded inputs separate', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const { rerender } = render(
        <OptionCard id="economical" title="Economical" onClick={onClick} />,
      )

      const choice = screen.getByRole('button', { name: 'Economical' })
      expect(choice).toHaveAttribute('aria-pressed', 'false')
      await user.tab()
      expect(choice).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(onClick).toHaveBeenCalledWith('economical')

      rerender(
        <OptionCard id="economical" selectedId="economical" title="Economical" onClick={onClick}>
          <label>
            Keywords
            <input type="number" defaultValue={5} />
          </label>
        </OptionCard>,
      )

      expect(choice).toHaveAttribute('aria-pressed', 'true')
      onClick.mockClear()
      await user.tab()
      const input = screen.getByRole('spinbutton', { name: 'Keywords' })
      expect(input).toHaveFocus()
      await user.clear(input)
      await user.type(input, '10')
      expect(input).toHaveValue(10)
      expect(onClick).not.toHaveBeenCalled()
    })

    it('should keep a nonselectable summary outside the tab order', () => {
      render(<OptionCard id="general" title="General" enableSelect={false} />)
      expect(screen.getByText('General')).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })
})
