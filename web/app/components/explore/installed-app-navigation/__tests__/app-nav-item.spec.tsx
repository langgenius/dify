import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppNavItem from '../app-nav-item'

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children?: ReactNode
    href: string
    prefetch?: boolean | null
  }) => (
    <a href={href} data-prefetch={prefetch === null ? 'auto' : prefetch} {...props}>
      {children}
    </a>
  ),
}))

const baseProps = {
  ariaLabel: 'My App',
  app: {
    id: 'app-123',
    app_owner_tenant_id: 'tenant-1',
    editable: true,
    is_pinned: false,
    last_used_at: null,
    uninstallable: false,
    app: {
      id: 'source-app-123',
      name: 'My App',
      description: 'Description',
      mode: 'chat',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#fff',
      icon_url: null,
      use_icon_as_answer_icon: false,
    },
  } satisfies InstalledAppResponse,
  isSelected: false,
  onTogglePin: vi.fn(),
  onDelete: vi.fn(),
}

describe('AppNavItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render name and item operation when expanded', () => {
      render(<AppNavItem {...baseProps} />)

      expect(screen.getByText('My App')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should render installed app navigation as a link', () => {
      render(<AppNavItem {...baseProps} />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('href', '/installed/app-123')
      expect(link).toHaveAttribute('aria-label', 'My App')
      expect(link).not.toHaveAttribute('aria-current')
      expect(link).toHaveAttribute('data-prefetch', 'false')
    })

    it('should use a contextual accessible name when ariaLabel is provided', () => {
      render(<AppNavItem {...baseProps} ariaLabel="Open My App web app" />)

      const link = screen.getByRole('link', { name: 'Open My App web app' })

      expect(link).toHaveAttribute('href', '/installed/app-123')
      expect(link).toHaveAttribute('aria-label', 'Open My App web app')
      expect(screen.getByText('My App')).toBeInTheDocument()
    })

    it('should enable prefetch after pointer intent', async () => {
      const user = userEvent.setup()
      render(<AppNavItem {...baseProps} />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('data-prefetch', 'false')

      await user.hover(link)

      expect(link).toHaveAttribute('data-prefetch', 'auto')
    })

    it('should enable prefetch after keyboard focus', async () => {
      const user = userEvent.setup()
      render(<AppNavItem {...baseProps} />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('data-prefetch', 'false')

      await user.tab()

      expect(link).toHaveFocus()
      expect(link).toHaveAttribute('data-prefetch', 'auto')
    })

    it('should expose selected state through the current link', () => {
      render(<AppNavItem {...baseProps} isSelected />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('aria-current', 'page')
    })

    it('should call onDelete with app id when delete action is clicked', async () => {
      const user = userEvent.setup()
      render(<AppNavItem {...baseProps} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(await screen.findByText('explore.sidebar.action.delete'))

      expect(baseProps.onDelete).toHaveBeenCalledWith('app-123')
    })

    it('should request the next pin state', async () => {
      const user = userEvent.setup()
      render(<AppNavItem {...baseProps} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
      await user.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(baseProps.onTogglePin).toHaveBeenCalledWith('app-123', true)
    })
  })

  describe('Edge Cases', () => {
    it('should not render delete action when app is uninstallable', async () => {
      const user = userEvent.setup()
      render(
        <AppNavItem
          {...baseProps}
          app={{
            ...baseProps.app,
            uninstallable: true,
          }}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

      expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()
    })
  })
})
