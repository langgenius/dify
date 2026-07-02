import { fireEvent, render, screen } from '@testing-library/react'
import AppNavItem from '../index'

const baseProps = {
  name: 'My App',
  id: 'app-123',
  icon_type: 'emoji' as const,
  icon: '🤖',
  icon_background: '#fff',
  icon_url: '',
  isSelected: false,
  isPinned: false,
  togglePin: vi.fn(),
  uninstallable: false,
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
      expect(screen.getByTestId('item-operation-trigger')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should render installed app navigation as a link', () => {
      render(<AppNavItem {...baseProps} />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('href', '/installed/app-123')
      expect(link).toHaveAttribute('aria-label', 'My App')
      expect(link).not.toHaveAttribute('aria-current')
    })

    it('should use a contextual accessible name when ariaLabel is provided', () => {
      render(<AppNavItem {...baseProps} variant="mainNav" ariaLabel="Open My App web app" />)

      const link = screen.getByRole('link', { name: 'Open My App web app' })

      expect(link).toHaveAttribute('href', '/installed/app-123')
      expect(link).toHaveAttribute('aria-label', 'Open My App web app')
      expect(screen.getByText('My App')).toBeInTheDocument()
    })

    it('should expose selected state through the current link', () => {
      render(<AppNavItem {...baseProps} isSelected />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('aria-current', 'page')
    })

    it('should only show the row focus ring when the app link receives focus', () => {
      render(<AppNavItem {...baseProps} />)

      const row = screen.getByText('My App').closest('.group')

      expect(row).toHaveClass('has-[>a:focus-visible]:inset-ring-2')
      expect(row).toHaveClass('has-[>a:focus-visible]:inset-ring-state-accent-solid')
      expect(row).not.toHaveClass('focus-within:ring-2')
    })

    it('should call onDelete with app id when delete action is clicked', async () => {
      render(<AppNavItem {...baseProps} />)

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      expect(baseProps.onDelete).toHaveBeenCalledWith('app-123')
    })
  })

  describe('Edge Cases', () => {
    it('should not render delete action when app is uninstallable', () => {
      render(<AppNavItem {...baseProps} uninstallable />)

      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()
    })
  })
})
