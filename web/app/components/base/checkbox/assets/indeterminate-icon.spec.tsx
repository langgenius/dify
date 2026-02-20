import { render, screen } from '@testing-library/react'
import IndeterminateIcon from './indeterminate-icon'

describe('IndeterminateIcon', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<IndeterminateIcon />)
      expect(screen.getByTestId('indeterminate-icon')).toBeInTheDocument()
    })

    it('should render an svg element', () => {
      const { container } = render(<IndeterminateIcon />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })
})
