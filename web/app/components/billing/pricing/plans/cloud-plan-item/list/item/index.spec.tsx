import { render, screen } from '@testing-library/react'
import Item from './index'

describe('Item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering the plan item row
  describe('Rendering', () => {
    it('should render the provided label when tooltip is absent', () => {
      // Arrange
      const label = 'Monthly credits'

      // Act
      const { container } = render(<Item label={label} />)

      // Assert
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector('.group')).toBeNull()
    })
  })

  // Toggling the optional tooltip indicator
  describe('Tooltip behavior', () => {
    it('should render tooltip content when tooltip text is provided', () => {
      // Arrange
      const label = 'Workspace seats'
      const tooltip = 'Seats define how many teammates can join the workspace.'

      // Act
      const { container } = render(<Item label={label} tooltip={tooltip} />)

      // Assert
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(tooltip)).toBeInTheDocument()
      expect(container.querySelector('.group')).not.toBeNull()
    })

    it('should treat an empty tooltip string as absent', () => {
      // Arrange
      const label = 'Vector storage'

      // Act
      const { container } = render(<Item label={label} tooltip="" />)

      // Assert
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector('.group')).toBeNull()
    })
  })
})
