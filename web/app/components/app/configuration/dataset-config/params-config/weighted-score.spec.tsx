import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WeightedScore from './weighted-score'

describe('WeightedScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render semantic and keyword weights', () => {
      // Arrange
      const onChange = vi.fn<(arg: { value: number[] }) => void>()
      const value = { value: [0.3, 0.7] }

      // Act
      render(<WeightedScore value={value} onChange={onChange} />)

      // Assert
      expect(screen.getByText('dataset.weightedScore.semantic')).toBeInTheDocument()
      expect(screen.getByText('dataset.weightedScore.keyword')).toBeInTheDocument()
      expect(screen.getByText('0.3')).toBeInTheDocument()
      expect(screen.getByText('0.7')).toBeInTheDocument()
    })

    it('should format a weight of 1 as 1.0', () => {
      // Arrange
      const onChange = vi.fn<(arg: { value: number[] }) => void>()
      const value = { value: [1, 0] }

      // Act
      render(<WeightedScore value={value} onChange={onChange} />)

      // Assert
      expect(screen.getByText('1.0')).toBeInTheDocument()
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should emit complementary weights when the slider value changes', async () => {
      // Arrange
      const onChange = vi.fn<(arg: { value: number[] }) => void>()
      const value = { value: [0.5, 0.5] }
      const user = userEvent.setup()
      render(<WeightedScore value={value} onChange={onChange} />)

      // Act
      await user.tab()
      const slider = screen.getByRole('slider')
      expect(slider).toHaveFocus()
      const callsBefore = onChange.mock.calls.length
      await user.keyboard('{ArrowRight}')

      // Assert
      expect(onChange.mock.calls.length).toBeGreaterThan(callsBefore)
      const lastCall = onChange.mock.calls.at(-1)?.[0]
      expect(lastCall?.value[0]).toBeCloseTo(0.6, 5)
      expect(lastCall?.value[1]).toBeCloseTo(0.4, 5)
    })

    it('should not call onChange when readonly is true', async () => {
      // Arrange
      const onChange = vi.fn<(arg: { value: number[] }) => void>()
      const value = { value: [0.5, 0.5] }
      const user = userEvent.setup()
      render(<WeightedScore value={value} onChange={onChange} readonly />)

      // Act
      await user.tab()
      const slider = screen.getByRole('slider')
      expect(slider).toHaveFocus()
      await user.keyboard('{ArrowRight}')

      // Assert
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
