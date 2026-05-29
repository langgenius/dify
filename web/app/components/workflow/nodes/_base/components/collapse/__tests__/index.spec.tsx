import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Collapse from '../index'

describe('Collapse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Collapse should toggle local state when interactive and stay fixed when disabled.
  describe('Interaction', () => {
    it('should expand collapsed content and notify onCollapse when clicked', async () => {
      const user = userEvent.setup()
      const onCollapse = vi.fn()

      render(
        <Collapse
          trigger={<div>Advanced</div>}
          onCollapse={onCollapse}
        >
          <div>Collapse content</div>
        </Collapse>,
      )

      expect(screen.queryByText('Collapse content')).not.toBeInTheDocument()

      await user.click(screen.getByText('Advanced'))

      expect(screen.getByText('Collapse content')).toBeInTheDocument()
      expect(onCollapse).toHaveBeenCalledWith(false)
    })

    it('should keep content collapsed when disabled', async () => {
      const user = userEvent.setup()
      const onCollapse = vi.fn()

      render(
        <Collapse
          disabled
          trigger={<div>Disabled section</div>}
          onCollapse={onCollapse}
        >
          <div>Hidden content</div>
        </Collapse>,
      )

      await user.click(screen.getByText('Disabled section'))

      expect(screen.queryByText('Hidden content')).not.toBeInTheDocument()
      expect(onCollapse).not.toHaveBeenCalled()
    })

    it('should respect controlled collapse state and render function triggers', async () => {
      const user = userEvent.setup()
      const onCollapse = vi.fn()

      render(
        <Collapse
          collapsed={false}
          hideCollapseIcon
          operations={<button type="button">Operation</button>}
          trigger={collapseIcon => (
            <div>
              <span>Controlled section</span>
              {collapseIcon}
            </div>
          )}
          onCollapse={onCollapse}
        >
          <div>Visible content</div>
        </Collapse>,
      )

      expect(screen.getByText('Visible content')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Operation' })).toBeInTheDocument()

      await user.click(screen.getByText('Controlled section'))

      expect(onCollapse).toHaveBeenCalledWith(true)
      expect(screen.getByText('Visible content')).toBeInTheDocument()
    })
  })
})
