import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DSLConfirmModal from '../dsl-confirm-modal'

describe('DSLConfirmModal', () => {
  it.each(['Cancel', 'Confirm'])(
    'shows the conflicting versions before choosing %s',
    async (action) => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      const onConfirm = vi.fn()
      render(
        <DSLConfirmModal
          versions={{ importedVersion: '1.0.0', systemVersion: '2.0.0' }}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      )
      expect(screen.getByText('1.0.0')).toBeInTheDocument()
      expect(screen.getByText('2.0.0')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: `app.newApp.${action}` }))
      expect(action === 'Cancel' ? onCancel : onConfirm).toHaveBeenCalledOnce()
      expect(action === 'Cancel' ? onConfirm : onCancel).not.toHaveBeenCalled()
    },
  )
})
