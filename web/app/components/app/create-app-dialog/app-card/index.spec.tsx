import { fireEvent, render, screen } from '@testing-library/react'
import AppCard from './index'
import type { AppIconType } from '@/types/app'
import { AppModeEnum } from '@/types/app'
import type { App } from '@/models/explore'

// Mock only external dependencies as per guidance
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

jest.mock('@heroicons/react/20/solid', () => ({
  PlusIcon: ({ className }: any) => <div data-testid="plus-icon" className={className} aria-label="Add icon">+</div>,
}))

const mockApp: App = {
  app: {
    id: 'test-app-id',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji' as AppIconType,
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

      // Check for app icon using its actual implementation
      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toBeInTheDocument()
      expect(screen.getByText('Test Chat App')).toBeInTheDocument()
      expect(screen.getByText(mockApp.description)).toBeInTheDocument()
    })

    it('should render app icon with correct props', () => {
      render(<AppCard {...defaultProps} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toBeInTheDocument()
      // Verify the icon is rendered (checking actual implementation behavior)
      expect(appIcon.closest('[data-icon-type="emoji"]')).toBeInTheDocument()
    })

    it('should render app type icon and label', () => {
      render(<AppCard {...defaultProps} />)

      expect(screen.getByTestId('app-type-icon')).toBeInTheDocument()
      expect(screen.getByTestId('app-type-label')).toBeInTheDocument()
      expect(screen.getByTestId('app-type-label')).toHaveTextContent('chat')
    })
  })

  describe('Props', () => {
    describe('canCreate behavior', () => {
      it('should show create button when canCreate is true', () => {
        render(<AppCard {...defaultProps} canCreate={true} />)

        const card = screen.getByTestId('app-icon').closest('.group')
        expect(card).toBeInTheDocument()
        fireEvent.mouseEnter(card!)
        const button = card!.querySelector('button')
        expect(button).toBeInTheDocument()
      })

      it('should hide create button when canCreate is false', () => {
        render(<AppCard {...defaultProps} canCreate={false} />)

        const card = screen.getByTestId('app-icon').closest('.group')
        expect(card).toBeInTheDocument()
        fireEvent.mouseEnter(card!)

        // Button should be hidden when canCreate is false
        const button = card!.querySelector('button')
        expect(button).not.toBeInTheDocument()
      })
    })

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
  })

  describe('App Modes - Data Driven Tests', () => {
    const testCases = [
      {
        mode: AppModeEnum.CHAT,
        expectedLabel: 'app.typeSelector.chatbot',
        description: 'Chat application mode',
      },
      {
        mode: AppModeEnum.AGENT_CHAT,
        expectedLabel: 'app.typeSelector.agent',
        description: 'Agent chat mode',
      },
      {
        mode: AppModeEnum.COMPLETION,
        expectedLabel: 'app.typeSelector.completion',
        description: 'Completion mode',
      },
      {
        mode: AppModeEnum.ADVANCED_CHAT,
        expectedLabel: 'app.typeSelector.advanced',
        description: 'Advanced chat mode',
      },
      {
        mode: AppModeEnum.WORKFLOW,
        expectedLabel: 'app.typeSelector.workflow',
        description: 'Workflow mode',
      },
    ]

    testCases.forEach(({ mode, expectedLabel, description }) => {
      it(`should display correct type label for ${description}`, () => {
        const appWithMode = {
          ...mockApp,
          app: {
            ...mockApp.app,
            mode,
          },
        }
        render(<AppCard {...defaultProps} app={appWithMode} />)

        const typeLabel = screen.getByTestId('app-type-label')
        expect(typeLabel).toBeInTheDocument()
        expect(typeLabel).toHaveTextContent(expectedLabel)
      })
    })
  })

  describe('Icon Type Tests', () => {
    const iconTestCases = [
      {
        icon_type: 'emoji' as AppIconType,
        icon: '🤖',
        description: 'emoji icon',
      },
      {
        icon_type: 'image' as AppIconType,
        icon: 'test-icon.png',
        description: 'image icon',
      },
      {
        icon_type: null,
        icon: 'default-icon',
        description: 'null icon type',
      },
    ]

    iconTestCases.forEach(({ icon_type, icon, description }) => {
      it(`should handle ${description}`, () => {
        const appWithIcon = {
          ...mockApp,
          app: {
            ...mockApp.app,
            icon_type,
            icon,
          },
        }
        render(<AppCard {...defaultProps} app={appWithIcon} />)

        const appIcon = screen.getByTestId('app-icon')
        expect(appIcon).toBeInTheDocument()
        // Verify icon type attribute is set correctly by AppIcon component
        if (icon_type)
          expect(appIcon).toHaveAttribute('data-icon-type', icon_type)
      })
    })

    it('should prioritize icon_url when both icon and icon_url are provided', () => {
      const appWithImageUrl = {
        ...mockApp,
        app: {
          ...mockApp.app,
          icon_type: 'image' as AppIconType,
          icon: 'local-icon.png',
          icon_url: 'https://example.com/remote-icon.png',
        },
      }
      render(<AppCard {...defaultProps} app={appWithImageUrl} />)

      const appIcon = screen.getByTestId('app-icon')
      expect(appIcon).toHaveAttribute('data-image-url', 'https://example.com/remote-icon.png')
    })
  })

  describe('User Interactions', () => {
    it('should call onCreate when create button is clicked', () => {
      const mockOnCreate = jest.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()
      fireEvent.mouseEnter(card!)
      const button = card!.querySelector('button')
      expect(button).toBeInTheDocument()
      fireEvent.click(button!)
      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })

    it('should handle click on card itself', () => {
      const mockOnCreate = jest.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()
      fireEvent.click(card!)
      // Note: Card click doesn't trigger onCreate, only the button does
      expect(mockOnCreate).not.toHaveBeenCalled()
    })

    it('should show create button on hover', () => {
      render(<AppCard {...defaultProps} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()
      fireEvent.mouseEnter(card!)
      const button = card!.querySelector('button')
      expect(button).toBeInTheDocument()
      expect(button).toHaveTextContent('app.newApp.useTemplate')
    })
  })

  describe('Keyboard Accessibility', () => {
    it('should allow the create button to be focused', () => {
      const mockOnCreate = jest.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()
      fireEvent.mouseEnter(card!)
      const button = card!.querySelector('button') as HTMLButtonElement
      expect(button).toBeInTheDocument()

      // Test that button can be focused
      button.focus()
      expect(button).toHaveFocus()

      // Test click event works (keyboard events on buttons typically trigger click)
      fireEvent.click(button)
      expect(mockOnCreate).toHaveBeenCalledTimes(1)
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
      expect(appIcon).toBeInTheDocument()
      // AppIcon component should handle null icon_type gracefully
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
      const longDescription = 'This is a very long description that should be truncated with line-clamp-3. '.repeat(5)
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

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()
      fireEvent.mouseEnter(card!)
      const button = card!.querySelector('button')
      expect(button).toBeInTheDocument()

      // The component catches errors from click handlers, so we just verify the function is called
      expect(() => {
        fireEvent.click(button!)
      }).not.toThrow()

      expect(errorOnCreate).toHaveBeenCalledTimes(1)

      consoleSpy.mockRestore()
    })
  })

  describe('Accessibility', () => {
    it('should have proper elements for accessibility', () => {
      render(<AppCard {...defaultProps} />)

      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
      expect(screen.getByTestId('app-type-icon')).toBeInTheDocument()
    })

    it('should have title attribute for app name when truncated', () => {
      render(<AppCard {...defaultProps} />)

      const nameElement = screen.getByText('Test Chat App')
      expect(nameElement).toHaveAttribute('title', 'Test Chat App')
    })

    it('should have accessible button with proper label', () => {
      render(<AppCard {...defaultProps} />)

      const card = screen.getByTestId('app-icon').closest('.group')
      expect(card).toBeInTheDocument()
      fireEvent.mouseEnter(card!)
      // Use query selector since the button is in a hidden element that becomes visible on hover
      const button = card!.querySelector('button')
      expect(button).toBeInTheDocument()
      expect(button).toBeEnabled()
      expect(button).toHaveTextContent('app.newApp.useTemplate')
    })
  })

  describe('User-Visible Behavior Tests', () => {
    it('should show plus icon in create button', () => {
      render(<AppCard {...defaultProps} />)

      expect(screen.getByTestId('plus-icon')).toBeInTheDocument()
    })
  })
})
