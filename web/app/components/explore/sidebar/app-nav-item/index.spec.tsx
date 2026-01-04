import { fireEvent, render, screen } from '@testing-library/react'
import AppNavItem from './index'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  return {
    ...actual,
    useHover: () => false,
  }
})

const baseProps = {
  isMobile: false,
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

  // Rendering: display app name for desktop and hide for mobile.
  describe('Rendering', () => {
    it('should render name and item operation on desktop', () => {
      // Arrange
      render(<AppNavItem {...baseProps} />)

      // Assert
      expect(screen.getByText('My App')).toBeInTheDocument()
      expect(screen.getByTestId('item-operation-trigger')).toBeInTheDocument()
    })

    it('should hide name on mobile', () => {
      // Arrange
      render(<AppNavItem {...baseProps} isMobile />)

      // Assert
      expect(screen.queryByText('My App')).not.toBeInTheDocument()
    })
  })

  // User interactions: navigation and delete flow.
  describe('User Interactions', () => {
    it('should navigate to installed app when item is clicked', () => {
      // Arrange
      render(<AppNavItem {...baseProps} />)

      // Act
      fireEvent.click(screen.getByText('My App'))

      // Assert
      expect(mockPush).toHaveBeenCalledWith('/explore/installed/app-123')
    })

    it('should call onDelete with app id when delete action is clicked', async () => {
      // Arrange
      render(<AppNavItem {...baseProps} />)

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      // Assert
      expect(baseProps.onDelete).toHaveBeenCalledWith('app-123')
    })
  })

  // Edge cases: hide delete when uninstallable or selected.
  describe('Edge Cases', () => {
    it('should not render delete action when app is uninstallable', () => {
      // Arrange
      render(<AppNavItem {...baseProps} uninstallable />)

      // Act
      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      // Assert
      expect(screen.queryByText('explore.sidebar.action.delete')).not.toBeInTheDocument()
    })
  })
})
