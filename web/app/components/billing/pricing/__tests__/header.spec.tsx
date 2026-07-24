import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Header from '../header'

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title and description translations', () => {
      const handleClose = vi.fn()

      render(<Header onClose={handleClose} />)

      expect(screen.getByText('billing.plansCommon.title.plans')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.title.description')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should invoke onClose when close button is clicked', () => {
      const handleClose = vi.fn()
      render(<Header onClose={handleClose} />)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should render structural elements with translation keys', () => {
      const { container } = render(<Header onClose={vi.fn()} />)

      expect(container.querySelector('span')).toBeInTheDocument()
      expect(container.querySelector('p')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
