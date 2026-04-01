import { render, screen } from '@testing-library/react'
import Item from '../index'

describe('Item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering the plan item row
  describe('Rendering', () => {
    it('should render the provided label when tooltip is absent', () => {
      const label = 'Monthly credits'

      const { container } = render(<Item label={label} />)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector('.group')).toBeNull()
    })
  })

  // Toggling the optional tooltip indicator
  describe('Tooltip behavior', () => {
    it('should render tooltip content when tooltip text is provided', () => {
      const label = 'Workspace seats'
      const tooltip = 'Seats define how many teammates can join the workspace.'

      const { container } = render(<Item label={label} tooltip={tooltip} />)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(tooltip)).toBeInTheDocument()
      expect(container.querySelector('.group')).not.toBeNull()
    })

    it('should treat an empty tooltip string as absent', () => {
      const label = 'Vector storage'

      const { container } = render(<Item label={label} tooltip="" />)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector('.group')).toBeNull()
    })
  })
})
