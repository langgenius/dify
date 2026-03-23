import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { Dialog } from '@/app/components/base/ui/dialog'
import Header from '../header'

function renderHeader(onClose: () => void) {
  return render(
    <Dialog open>
      <Header onClose={onClose} />
    </Dialog>,
  )
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title and description translations', () => {
      const handleClose = vi.fn()

      renderHeader(handleClose)

      expect(screen.getByText('billing.plansCommon.title.plans')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.title.description')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should invoke onClose when close button is clicked', () => {
      const handleClose = vi.fn()
      renderHeader(handleClose)

      fireEvent.click(screen.getByRole('button'))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should render structural elements with translation keys', () => {
      const { container } = renderHeader(vi.fn())

      expect(container.querySelector('span')).toBeInTheDocument()
      expect(container.querySelector('p')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
