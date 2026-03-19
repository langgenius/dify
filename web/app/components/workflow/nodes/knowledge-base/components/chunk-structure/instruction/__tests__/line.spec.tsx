import { render } from '@testing-library/react'
import Line from '../line'

describe('ChunkStructureInstructionLine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The line should switch between vertical and horizontal SVG assets.
  describe('Rendering', () => {
    it('should render the vertical line by default', () => {
      const { container } = render(<Line />)
      const svg = container.querySelector('svg')

      expect(svg).toHaveAttribute('width', '2')
      expect(svg).toHaveAttribute('height', '132')
    })

    it('should render the horizontal line when requested', () => {
      const { container } = render(<Line type="horizontal" />)
      const svg = container.querySelector('svg')

      expect(svg).toHaveAttribute('width', '240')
      expect(svg).toHaveAttribute('height', '2')
    })
  })
})
