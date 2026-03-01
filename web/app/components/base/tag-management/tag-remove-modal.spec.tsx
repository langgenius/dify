import type { Tag } from './constant'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagRemoveModal from './tag-remove-modal'

const mockTag: Tag = {
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: 3,
}

describe('TagRemoveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior and visibility control.
  describe('Rendering', () => {
    it('should render modal content when show is true', () => {
      render(
        <TagRemoveModal
          show={true}
          tag={mockTag}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByText('common.tag.delete')).toBeInTheDocument()
      expect(screen.getByText('"Frontend"')).toBeInTheDocument()
      expect(screen.getByText('common.tag.deleteTip')).toBeInTheDocument()
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should not render modal content when show is false', () => {
      render(
        <TagRemoveModal
          show={false}
          tag={mockTag}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      expect(screen.queryByText('common.tag.delete')).not.toBeInTheDocument()
      expect(screen.queryByText('common.tag.deleteTip')).not.toBeInTheDocument()
    })
  })

  // User interactions for closing and confirming actions.
  describe('User Interactions', () => {
    it('should call onClose when top-right close icon is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <TagRemoveModal
          show={true}
          tag={mockTag}
          onConfirm={vi.fn()}
          onClose={onClose}
        />,
      )

      const closeIconButton = screen.getByTestId('tag-remove-modal-close-button')
      expect(closeIconButton).toBeInTheDocument()
      await user.click(closeIconButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <TagRemoveModal
          show={true}
          tag={mockTag}
          onConfirm={vi.fn()}
          onClose={onClose}
        />,
      )

      await user.click(screen.getByText('common.operation.cancel'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirm when delete button is clicked', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()

      render(
        <TagRemoveModal
          show={true}
          tag={mockTag}
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      )

      await user.click(screen.getByText('common.operation.delete'))
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  // Edge case for unusual tag names in the title.
  describe('Edge Cases', () => {
    it('should render quoted empty tag name safely', () => {
      render(
        <TagRemoveModal
          show={true}
          tag={{ ...mockTag, name: '' }}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )

      expect(screen.getByText('""')).toBeInTheDocument()
    })
  })
})
