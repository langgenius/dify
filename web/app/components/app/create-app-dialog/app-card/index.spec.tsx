import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AppCard from './index'
import { AppModeEnum } from '@/types/app'
import type { App } from '@/models/explore'

// Mock external dependencies
jest.mock('@/app/components/base/app-icon', () => ({
  __esModule: true,
  default: ({ size, iconType, icon, background, imageUrl }: any) => (
    <div data-testid="app-icon" data-size={size} data-icon-type={iconType} data-icon={icon} data-background={background} data-image-url={imageUrl}>
      App Icon
    </div>
  ),
}))

jest.mock('@/app/components/app/type-selector', () => ({
  AppTypeIcon: ({ type, className, wrapperClassName }: any) => (
    <div data-testid="app-type-icon" data-type={type} className={className} data-wrapper-class={wrapperClassName}>
      Type Icon
    </div>
  ),
  AppTypeLabel: ({ type, className }: any) => (
    <div data-testid="app-type-label" data-type={type} className={className}>
      {type}
    </div>
  ),
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

jest.mock('@heroicons/react/20/solid', () => ({
  PlusIcon: ({ className }: any) => <div data-testid="plus-icon" className={className}>+</div>,
}))

const mockApp: App = {
  app: {
    id: 'test-app-id',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_url: '',
    name: 'Test Chat App',
    description: 'A test chat application for demonstration purposes',
    use_icon_as_answer_icon: false,
  },
  app_id: 'test-app-id',
  description: 'A comprehensive chat application template',
  copyright: 'Test Corp',
  privacy_policy: null,
  custom_disclaimer: null,
  category: 'Assistant',
  position: 1,
  is_listed: true,
  install_count: 100,
  installed: false,
  editable: true,
  is_agent: false,
}

describe('AppCard', () => {
  const defaultProps = {
    app: mockApp,
    canCreate: true,
    onCreate: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AppCard {...defaultProps} />)

      expect(screen.getByText('Test Chat App')).toBeInTheDocument()
      expect(screen.getByText(mockApp.description)).toBeInTheDocument()
    })

    it('should render app icon with correct props', () => {
      render(<AppCard {...defaultProps} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-size', 'large')
      expect(appIcon).toHaveAttribute('data-icon-type', 'emoji')
      expect(appIcon).toHaveAttribute('data-icon', '🤖')
      expect(appIcon).toHaveAttribute('data-background', '#FFEAD5')
    })

    it('should render app type icon and label', () => {
      render(<AppCard {...defaultProps} />)

      expect(screen.getByTestId('app-type-icon')).toHaveAttribute('data-type', AppModeEnum.CHAT)
      expect(screen.getByTestId('app-type-label')).toHaveAttribute('data-type', AppModeEnum.CHAT)
    })

    it('should show create button on render', () => {
      render(<AppCard {...defaultProps} />)

      expect(screen.getByText('app.newApp.useTemplate')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display app name from appBasicInfo', () => {
      const customApp = {
        ...mockApp,
        app: {
          ...mockApp.app,
          name: 'Custom App Name',
        },
      }
      render(<AppCard {...defaultProps} app={customApp} />)

      expect(screen.getByText('Custom App Name')).toBeInTheDocument()
    })

    it('should display app description from app level', () => {
      const customApp = {
        ...mockApp,
        description: 'Custom description for the app',
      }
      render(<AppCard {...defaultProps} app={customApp} />)

      expect(screen.getByText('Custom description for the app')).toBeInTheDocument()
    })

    it('should truncate long app names', () => {
      const longNameApp = {
        ...mockApp,
        app: {
          ...mockApp.app,
          name: 'This is a very long app name that should be truncated with line-clamp-1',
        },
      }
      render(<AppCard {...defaultProps} app={longNameApp} />)

      const nameElement = screen.getByTitle('This is a very long app name that should be truncated with line-clamp-1')
      expect(nameElement).toBeInTheDocument()
    })

    it('should handle different app modes', () => {
      const agentApp = {
        ...mockApp,
        app: {
          ...mockApp.app,
          mode: AppModeEnum.AGENT_CHAT,
        },
      }
      render(<AppCard {...defaultProps} app={agentApp} />)

      expect(screen.getByTestId('app-type-icon')).toHaveAttribute('data-type', AppModeEnum.AGENT_CHAT)
      expect(screen.getByTestId('app-type-label')).toHaveAttribute('data-type', AppModeEnum.AGENT_CHAT)
    })
  })

  describe('User Interactions', () => {
    it('should show create button on hover', async () => {
      render(<AppCard {...defaultProps} />)

      // Get the root card element
      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()

      // Button is visible by default
      expect(screen.getByText('app.newApp.useTemplate')).toBeInTheDocument()
      expect(screen.getByTestId('plus-icon')).toBeInTheDocument()

      if (card) {
        fireEvent.mouseEnter(card)

        // Button should still be visible on hover
        await waitFor(() => {
          expect(screen.getByText('app.newApp.useTemplate')).toBeInTheDocument()
          expect(screen.getByTestId('plus-icon')).toBeInTheDocument()
        })
      }
    })

    it('should keep create button visible after hover ends', async () => {
      render(<AppCard {...defaultProps} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()

      if (card) {
        fireEvent.mouseEnter(card)

        await waitFor(() => {
          expect(screen.getByText('app.newApp.useTemplate')).toBeInTheDocument()
        })

        fireEvent.mouseLeave(card)

        // Button should still be visible
        expect(screen.getByText('app.newApp.useTemplate')).toBeInTheDocument()
      }
    })

    it('should call onCreate when create button is clicked', async () => {
      const mockOnCreate = jest.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      // Button is visible by default, no need to hover
      const createButton = screen.getByText('app.newApp.useTemplate')
      expect(createButton).toBeInTheDocument()

      fireEvent.click(createButton)
      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })

    it('should handle click on card itself', () => {
      const mockOnCreate = jest.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()

      if (card) {
        fireEvent.click(card)

        // Note: Card click doesn't trigger onCreate, only the button does
        expect(mockOnCreate).not.toHaveBeenCalled()
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle app with null icon_type', () => {
      const appWithNullIcon = {
        ...mockApp,
        app: {
          ...mockApp.app,
          icon_type: null,
        },
      }
      render(<AppCard {...defaultProps} app={appWithNullIcon} />)

      const appIcon = screen.getByTestId('app-icon')
      // When icon_type is null, the attribute might not be set
      const iconTypeValue = appIcon.getAttribute('data-icon-type')
      expect(['null', null].includes(iconTypeValue)).toBe(true)
    })

    it('should handle app with empty description', () => {
      const appWithEmptyDesc = {
        ...mockApp,
        description: '',
      }
      render(<AppCard {...defaultProps} app={appWithEmptyDesc} />)

      // Find the description container directly
      const descriptionContainer = document.querySelector('.line-clamp-3')
      expect(descriptionContainer).toBeInTheDocument()
      // The empty text content is handled gracefully
    })

    it('should handle app with very long description', () => {
      const longDescription = 'This is a very long description that should be truncated with line-clamp-3. '.repeat(5) // Reduce length for test stability
      const appWithLongDesc = {
        ...mockApp,
        description: longDescription,
      }
      render(<AppCard {...defaultProps} app={appWithLongDesc} />)

      // Check that the description container exists
      const descriptionContainer = document.querySelector('.line-clamp-3')
      expect(descriptionContainer).toBeInTheDocument()
      // Check that it contains part of the description (truncated by line-clamp)
      expect(descriptionContainer).toHaveTextContent(/This is a very long description/)
    })

    it('should handle app with special characters in name', () => {
      const appWithSpecialChars = {
        ...mockApp,
        app: {
          ...mockApp.app,
          name: 'App <script>alert("test")</script> & Special "Chars"',
        },
      }
      render(<AppCard {...defaultProps} app={appWithSpecialChars} />)

      expect(screen.getByText('App <script>alert("test")</script> & Special "Chars"')).toBeInTheDocument()
    })

    it('should handle onCreate function throwing error', () => {
      const errorOnCreate = jest.fn(() => {
        throw new Error('Create failed')
      })

      // Mock console.error to avoid test output noise
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(jest.fn())

      render(<AppCard {...defaultProps} onCreate={errorOnCreate} />)

      const createButton = screen.getByText('app.newApp.useTemplate')

      // The component catches errors from click handlers, so we just verify the function is called
      expect(() => {
        fireEvent.click(createButton)
      }).not.toThrow()

      expect(errorOnCreate).toHaveBeenCalledTimes(1)

      consoleSpy.mockRestore()
    })
  })

  describe('Accessibility', () => {
    it('should have proper cursor pointer styling', () => {
      render(<AppCard {...defaultProps} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toHaveClass('cursor-pointer')
    })

    it('should have title attribute for app name when truncated', () => {
      render(<AppCard {...defaultProps} />)

      const nameElement = screen.getByText('Test Chat App')
      expect(nameElement).toHaveAttribute('title', 'Test Chat App')
    })
  })

  describe('CSS Classes', () => {
    it('should apply correct base classes', () => {
      render(<AppCard {...defaultProps} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toHaveClass(
        'group',
        'relative',
        'flex',
        'h-[132px]',
        'cursor-pointer',
        'flex-col',
        'overflow-hidden',
        'rounded-xl',
        'border-[0.5px]',
        'border-components-panel-border',
        'bg-components-panel-on-panel-item-bg',
        'p-4',
        'shadow-xs',
        'hover:shadow-lg',
      )
    })

    it('should apply proper typography classes', () => {
      render(<AppCard {...defaultProps} />)

      const nameElement = screen.getByText('Test Chat App')
      expect(nameElement).toHaveClass('system-md-semibold', 'text-text-secondary')

      const descriptionElement = screen.getByText(mockApp.description).closest('.system-xs-regular')
      expect(descriptionElement).toHaveClass('system-xs-regular', 'text-text-tertiary')
    })
  })
})
