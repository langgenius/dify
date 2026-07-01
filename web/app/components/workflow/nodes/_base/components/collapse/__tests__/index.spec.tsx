import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Collapse,
  CollapseActions,
  CollapseContent,
  CollapseHeader,
  CollapseIndicator,
  CollapseTitle,
  CollapseTrigger,
} from '../index'

function TestCollapse({
  children,
  title,
  actions,
  ...props
}: {
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
  disabled?: boolean
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}) {
  return (
    <Collapse {...props}>
      <CollapseHeader>
        <CollapseTrigger>
          <CollapseTitle>{title}</CollapseTitle>
          <CollapseIndicator />
        </CollapseTrigger>
        {actions != null && (
          <CollapseActions>
            {actions}
          </CollapseActions>
        )}
      </CollapseHeader>
      <CollapseContent>
        {children}
      </CollapseContent>
    </Collapse>
  )
}

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
        <TestCollapse
          title="Advanced"
          onCollapse={onCollapse}
        >
          <div>Collapse content</div>
        </TestCollapse>,
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
        <TestCollapse
          disabled
          title="Disabled section"
          onCollapse={onCollapse}
        >
          <div>Hidden content</div>
        </TestCollapse>,
      )

      await user.click(screen.getByText('Disabled section'))

      expect(screen.queryByText('Hidden content')).not.toBeInTheDocument()
      expect(onCollapse).not.toHaveBeenCalled()
    })

    it('should respect controlled collapse state and render actions separately', async () => {
      const user = userEvent.setup()
      const onCollapse = vi.fn()

      render(
        <TestCollapse
          collapsed={false}
          actions={<button type="button">Operation</button>}
          title="Controlled section"
          onCollapse={onCollapse}
        >
          <div>Visible content</div>
        </TestCollapse>,
      )

      expect(screen.getByText('Visible content')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Operation' })).toBeInTheDocument()

      await user.click(screen.getByText('Controlled section'))

      expect(onCollapse).toHaveBeenCalledWith(true)
      expect(screen.getByText('Visible content')).toBeInTheDocument()
    })
  })
})
