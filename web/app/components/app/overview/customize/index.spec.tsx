import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import CustomizeModal from './index'

// Mock useDocLink from context
const mockDocLink = vi.fn((path?: string) => `https://docs.dify.ai/en-US${path || ''}`)
vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

// Mock window.open
const mockWindowOpen = vi.fn()
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true,
})

describe('CustomizeModal', () => {
  const defaultProps = {
    isShow: true,
    onClose: vi.fn(),
    api_base_url: 'https://api.example.com',
    appId: 'test-app-id-123',
    mode: AppModeEnum.CHAT,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests - verify component renders correctly with various configurations
  describe('Rendering', () => {
    it('should render without crashing when isShow is true', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('appOverview.overview.appInfo.customize.title')).toBeInTheDocument()
      })
    })

    it('should not render content when isShow is false', async () => {
      // Arrange
      const props = { ...defaultProps, isShow: false }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText('appOverview.overview.appInfo.customize.title')).not.toBeInTheDocument()
      })
    })

    it('should render modal description', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('appOverview.overview.appInfo.customize.explanation')).toBeInTheDocument()
      })
    })

    it('should render way 1 and way 2 tags', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('appOverview.overview.appInfo.customize.way 1')).toBeInTheDocument()
        expect(screen.getByText('appOverview.overview.appInfo.customize.way 2')).toBeInTheDocument()
      })
    })

    it('should render all step numbers (1, 2, 3)', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument()
        expect(screen.getByText('2')).toBeInTheDocument()
        expect(screen.getByText('3')).toBeInTheDocument()
      })
    })

    it('should render step instructions', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByText('appOverview.overview.appInfo.customize.way1.step1')).toBeInTheDocument()
        expect(screen.getByText('appOverview.overview.appInfo.customize.way1.step2')).toBeInTheDocument()
        expect(screen.getByText('appOverview.overview.appInfo.customize.way1.step3')).toBeInTheDocument()
      })
    })

    it('should render environment variables with appId and api_base_url', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_APP_ID/i).closest('pre')
        expect(preElement).toBeInTheDocument()
        expect(preElement?.textContent).toContain('NEXT_PUBLIC_APP_ID=\'test-app-id-123\'')
        expect(preElement?.textContent).toContain('NEXT_PUBLIC_API_URL=\'https://api.example.com\'')
      })
    })

    it('should render GitHub icon in step 1 button', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert - find the GitHub link and verify it contains an SVG icon
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toBeInTheDocument()
        expect(githubLink.querySelector('svg')).toBeInTheDocument()
      })
    })
  })

  // Props tests - verify props are correctly applied
  describe('Props', () => {
    it('should display correct appId in environment variables', async () => {
      // Arrange
      const customAppId = 'custom-app-id-456'
      const props = { ...defaultProps, appId: customAppId }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_APP_ID/i).closest('pre')
        expect(preElement?.textContent).toContain(`NEXT_PUBLIC_APP_ID='${customAppId}'`)
      })
    })

    it('should display correct api_base_url in environment variables', async () => {
      // Arrange
      const customApiUrl = 'https://custom-api.example.com'
      const props = { ...defaultProps, api_base_url: customApiUrl }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_API_URL/i).closest('pre')
        expect(preElement?.textContent).toContain(`NEXT_PUBLIC_API_URL='${customApiUrl}'`)
      })
    })
  })

  // Mode-based conditional rendering tests - verify GitHub link changes based on app mode
  describe('Mode-based GitHub link', () => {
    it('should link to webapp-conversation repo for CHAT mode', async () => {
      // Arrange
      const props = { ...defaultProps, mode: AppModeEnum.CHAT }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toHaveAttribute('href', 'https://github.com/langgenius/webapp-conversation')
      })
    })

    it('should link to webapp-conversation repo for ADVANCED_CHAT mode', async () => {
      // Arrange
      const props = { ...defaultProps, mode: AppModeEnum.ADVANCED_CHAT }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toHaveAttribute('href', 'https://github.com/langgenius/webapp-conversation')
      })
    })

    it('should link to webapp-text-generator repo for COMPLETION mode', async () => {
      // Arrange
      const props = { ...defaultProps, mode: AppModeEnum.COMPLETION }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toHaveAttribute('href', 'https://github.com/langgenius/webapp-text-generator')
      })
    })

    it('should link to webapp-text-generator repo for WORKFLOW mode', async () => {
      // Arrange
      const props = { ...defaultProps, mode: AppModeEnum.WORKFLOW }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toHaveAttribute('href', 'https://github.com/langgenius/webapp-text-generator')
      })
    })

    it('should link to webapp-text-generator repo for AGENT_CHAT mode', async () => {
      // Arrange
      const props = { ...defaultProps, mode: AppModeEnum.AGENT_CHAT }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toHaveAttribute('href', 'https://github.com/langgenius/webapp-text-generator')
      })
    })
  })

  // External links tests - verify external links have correct security attributes
  describe('External links', () => {
    it('should have GitHub repo link that opens in new tab', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        expect(githubLink).toHaveAttribute('target', '_blank')
        expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer')
      })
    })

    it('should have Vercel docs link that opens in new tab', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const vercelLink = screen.getByRole('link', { name: /step2Operation/i })
        expect(vercelLink).toHaveAttribute('href', 'https://vercel.com/docs/concepts/deployments/git/vercel-for-github')
        expect(vercelLink).toHaveAttribute('target', '_blank')
        expect(vercelLink).toHaveAttribute('rel', 'noopener noreferrer')
      })
    })
  })

  // User interactions tests - verify user actions trigger expected behaviors
  describe('User Interactions', () => {
    it('should call window.open with doc link when way 2 button is clicked', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      await waitFor(() => {
        expect(screen.getByText('appOverview.overview.appInfo.customize.way2.operation')).toBeInTheDocument()
      })

      const way2Button = screen.getByText('appOverview.overview.appInfo.customize.way2.operation').closest('button')
      expect(way2Button).toBeInTheDocument()
      fireEvent.click(way2Button!)

      // Assert
      expect(mockWindowOpen).toHaveBeenCalledTimes(1)
      expect(mockWindowOpen).toHaveBeenCalledWith(
        expect.stringContaining('/use-dify/publish/developing-with-apis'),
        '_blank',
      )
    })

    it('should call onClose when modal close button is clicked', async () => {
      // Arrange
      const onClose = vi.fn()
      const props = { ...defaultProps, onClose }

      // Act
      render(<CustomizeModal {...props} />)

      // Wait for modal to be fully rendered
      await waitFor(() => {
        expect(screen.getByText('appOverview.overview.appInfo.customize.title')).toBeInTheDocument()
      })

      // Find the close button by navigating from the heading to the close icon
      // The close icon is an SVG inside a sibling div of the title
      const heading = screen.getByRole('heading', { name: /customize\.title/i })
      const closeIcon = heading.parentElement!.querySelector('svg')

      // Assert - closeIcon must exist for the test to be valid
      expect(closeIcon).toBeInTheDocument()
      fireEvent.click(closeIcon!)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Edge cases tests - verify component handles boundary conditions
  describe('Edge Cases', () => {
    it('should handle empty appId', async () => {
      // Arrange
      const props = { ...defaultProps, appId: '' }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_APP_ID/i).closest('pre')
        expect(preElement?.textContent).toContain('NEXT_PUBLIC_APP_ID=\'\'')
      })
    })

    it('should handle empty api_base_url', async () => {
      // Arrange
      const props = { ...defaultProps, api_base_url: '' }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_API_URL/i).closest('pre')
        expect(preElement?.textContent).toContain('NEXT_PUBLIC_API_URL=\'\'')
      })
    })

    it('should handle special characters in appId', async () => {
      // Arrange
      const specialAppId = 'app-id-with-special-chars_123'
      const props = { ...defaultProps, appId: specialAppId }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_APP_ID/i).closest('pre')
        expect(preElement?.textContent).toContain(`NEXT_PUBLIC_APP_ID='${specialAppId}'`)
      })
    })

    it('should handle URL with special characters in api_base_url', async () => {
      // Arrange
      const specialApiUrl = 'https://api.example.com:8080/v1'
      const props = { ...defaultProps, api_base_url: specialApiUrl }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert
      await waitFor(() => {
        const preElement = screen.getByText(/NEXT_PUBLIC_API_URL/i).closest('pre')
        expect(preElement?.textContent).toContain(`NEXT_PUBLIC_API_URL='${specialApiUrl}'`)
      })
    })
  })

  // StepNum component tests - verify step number styling
  describe('StepNum component', () => {
    it('should render step numbers with correct styling class', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert - The StepNum component is the direct container of the text
      await waitFor(() => {
        const stepNumber1 = screen.getByText('1')
        expect(stepNumber1).toHaveClass('rounded-2xl')
      })
    })
  })

  // GithubIcon component tests - verify GitHub icon renders correctly
  describe('GithubIcon component', () => {
    it('should render GitHub icon SVG within GitHub link button', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<CustomizeModal {...props} />)

      // Assert - Find GitHub link and verify it contains an SVG icon with expected class
      await waitFor(() => {
        const githubLink = screen.getByRole('link', { name: /step1Operation/i })
        const githubIcon = githubLink.querySelector('svg')
        expect(githubIcon).toBeInTheDocument()
        expect(githubIcon).toHaveClass('text-text-secondary')
      })
    })
  })
})
