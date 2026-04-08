import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import Header from '../header'

function renderHeader(onClose: () => void) {
  return render(
    <Dialog open>
      <DialogContent>
        <Header onClose={onClose} />
      </DialogContent>
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
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should invoke onClose when close button is clicked', () => {
      const handleClose = vi.fn()
      renderHeader(handleClose)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should render structural elements with translation keys', () => {
      renderHeader(vi.fn())

      expect(screen.getByText('billing.plansCommon.title.plans')).toBeInTheDocument()
      expect(screen.getByText('billing.plansCommon.title.description')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })
  })
})
