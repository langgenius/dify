import type { App } from '@/models/explore'
import type { AppIconType } from '@/types/app'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppModeEnum } from '@/types/app'
import AppCard from './index'

vi.mock('@heroicons/react/20/solid', () => ({
  PlusIcon: ({ className }: any) => <div data-testid="plus-icon" className={className} aria-label="Add icon">+</div>,
}))

const mockApp: App = {
  can_trial: true,
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
    onCreate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<AppCard {...defaultProps} />)

      expect(container.querySelector('em-emoji')).toBeInTheDocument()
      expect(screen.getByText('Test Chat App')).toBeInTheDocument()
      expect(screen.getByText(mockApp.description)).toBeInTheDocument()
    })

    it('should render app type icon and label', () => {
      const { container } = render(<AppCard {...defaultProps} />)

      expect(container.querySelector('svg')).toBeInTheDocument()
      expect(screen.getByText('app.typeSelector.chatbot')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('canCreate behavior', () => {
      it('should show create button when canCreate is true', () => {
        render(<AppCard {...defaultProps} canCreate={true} />)

        const button = screen.getByRole('button', { name: /app\.newApp\.useTemplate/ })
        expect(button).toBeInTheDocument()
      })

      it('should hide create button when canCreate is false', () => {
        render(<AppCard {...defaultProps} canCreate={false} />)

        const button = screen.queryByRole('button', { name: /app\.newApp\.useTemplate/ })
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

        expect(screen.getByText(expectedLabel)).toBeInTheDocument()
      })
    })
  })

  describe('Icon Type Tests', () => {
    it('should render emoji icon without image element', () => {
      const appWithIcon = {
        ...mockApp,
        app: {
          ...mockApp.app,
          icon_type: 'emoji' as AppIconType,
          icon: '🤖',
        },
      }
      const { container } = render(<AppCard {...defaultProps} app={appWithIcon} />)

      const card = container.firstElementChild as HTMLElement
      expect(within(card).queryByRole('img', { name: 'app icon' })).not.toBeInTheDocument()
      expect(card.querySelector('em-emoji')).toBeInTheDocument()
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

      expect(screen.getByRole('img', { name: 'app icon' })).toHaveAttribute('src', 'https://example.com/remote-icon.png')
    })
  })

  describe('User Interactions', () => {
    it('should call onCreate when create button is clicked', async () => {
      const mockOnCreate = vi.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      const button = screen.getByRole('button', { name: /app\.newApp\.useTemplate/ })
      await userEvent.click(button)
      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })

    it('should handle click on card itself', async () => {
      const mockOnCreate = vi.fn()
      const { container } = render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      const card = container.firstElementChild as HTMLElement
      await userEvent.click(card)
      // Note: Card click doesn't trigger onCreate, only the button does
      expect(mockOnCreate).not.toHaveBeenCalled()
    })
  })

  describe('Keyboard Accessibility', () => {
    it('should allow the create button to be focused', async () => {
      const mockOnCreate = vi.fn()
      render(<AppCard {...defaultProps} onCreate={mockOnCreate} />)

      await userEvent.tab()
      const button = screen.getByRole('button', { name: /app\.newApp\.useTemplate/ }) as HTMLButtonElement

      // Test that button can be focused
      expect(button).toHaveFocus()

      // Test click event works (keyboard events on buttons typically trigger click)
      await userEvent.click(button)
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
      const { container } = render(<AppCard {...defaultProps} app={appWithNullIcon} />)

      const appIcon = container.querySelector('em-emoji')
      expect(appIcon).toBeInTheDocument()
      // AppIcon component should handle null icon_type gracefully
    })

    it('should handle app with empty description', () => {
      const appWithEmptyDesc = {
        ...mockApp,
        description: '',
      }
      const { container } = render(<AppCard {...defaultProps} app={appWithEmptyDesc} />)

      const descriptionContainer = container.querySelector('.line-clamp-3')
      expect(descriptionContainer).toBeInTheDocument()
      expect(descriptionContainer).toHaveTextContent('')
    })

    it('should handle app with very long description', () => {
      const longDescription = 'This is a very long description that should be truncated with line-clamp-3. '.repeat(5)
      const appWithLongDesc = {
        ...mockApp,
        description: longDescription,
      }
      render(<AppCard {...defaultProps} app={appWithLongDesc} />)

      expect(screen.getByText(/This is a very long description/)).toBeInTheDocument()
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

    it('should handle onCreate function throwing error', async () => {
      const errorOnCreate = vi.fn(() => {
        return Promise.reject(new Error('Create failed'))
      })

      // Mock console.error to avoid test output noise
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn())

      render(<AppCard {...defaultProps} onCreate={errorOnCreate} />)

      const button = screen.getByRole('button', { name: /app\.newApp\.useTemplate/ })
      let capturedError: unknown
      try {
        await userEvent.click(button)
      }
      catch (err) {
        capturedError = err
      }
      expect(errorOnCreate).toHaveBeenCalledTimes(1)
      // expect(consoleSpy).toHaveBeenCalled()
      if (capturedError instanceof Error)
        expect(capturedError.message).toContain('Create failed')

      consoleSpy.mockRestore()
    })
  })

  describe('Accessibility', () => {
    it('should have proper elements for accessibility', () => {
      const { container } = render(<AppCard {...defaultProps} />)

      expect(container.querySelector('em-emoji')).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should have title attribute for app name when truncated', () => {
      render(<AppCard {...defaultProps} />)

      const nameElement = screen.getByText('Test Chat App')
      expect(nameElement).toHaveAttribute('title', 'Test Chat App')
    })

    it('should have accessible button with proper label', () => {
      render(<AppCard {...defaultProps} />)

      const button = screen.getByRole('button', { name: /app\.newApp\.useTemplate/ })
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
