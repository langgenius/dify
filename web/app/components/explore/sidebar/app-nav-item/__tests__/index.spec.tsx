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
    it('should render name and item operation on desktop', () => {
      render(<AppNavItem {...baseProps} />)

      expect(screen.getByText('My App')).toBeInTheDocument()
      expect(screen.getByTestId('item-operation-trigger')).toBeInTheDocument()
    })

    it('should use responsive selectors for mobile content', () => {
      render(<AppNavItem {...baseProps} />)

      expect(screen.getByText('My App')).toHaveClass('hidden', 'pc:block')
      expect(screen.getByTestId('item-operation-trigger').parentElement).toHaveClass('hidden', 'pc:block')
    })

    it('should render icon-only content when folded', () => {
      render(<AppNavItem {...baseProps} isFolded />)

      expect(screen.getByRole('link', { name: 'My App' })).toBeInTheDocument()
      expect(screen.queryByText('My App')).not.toBeInTheDocument()
      expect(screen.queryByTestId('item-operation-trigger')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should render installed app navigation as a link', () => {
      render(<AppNavItem {...baseProps} />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('href', '/installed/app-123')
      expect(link).not.toHaveAttribute('aria-current')
    })

    it('should expose selected state through the current link', () => {
      render(<AppNavItem {...baseProps} isSelected />)

      const link = screen.getByRole('link', { name: 'My App' })

      expect(link).toHaveAttribute('aria-current', 'page')
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
