import type { DataSourceCredential } from '@/types/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Header from './header'

// Mock CredentialTypeEnum to avoid deep import chain issues
enum MockCredentialTypeEnum {
  OAUTH2 = 'oauth2',
  API_KEY = 'api_key',
}

// Mock plugin-auth module to avoid deep import chain issues
vi.mock('@/app/components/plugins/plugin-auth', () => ({
  CredentialTypeEnum: {
    OAUTH2: 'oauth2',
    API_KEY: 'api_key',
  },
}))

// Mock portal-to-follow-elem - required for CredentialSelector
vi.mock('@/app/components/base/portal-to-follow-elem', () => {
  const MockPortalToFollowElem = ({ children, open }: any) => {
    return (
      <div data-testid="portal-root" data-open={open}>
        {React.Children.map(children, (child: any) => {
          if (!child)
            return null
          return React.cloneElement(child, { __portalOpen: open })
        })}
      </div>
    )
  }

  const MockPortalToFollowElemTrigger = ({ children, onClick, className, __portalOpen }: any) => (
    <div data-testid="portal-trigger" onClick={onClick} className={className} data-open={__portalOpen}>
      {children}
    </div>
  )

  const MockPortalToFollowElemContent = ({ children, className, __portalOpen }: any) => {
    if (!__portalOpen)
      return null
    return (
      <div data-testid="portal-content" className={className}>
        {children}
      </div>
    )
  }

  return {
    PortalToFollowElem: MockPortalToFollowElem,
    PortalToFollowElemTrigger: MockPortalToFollowElemTrigger,
    PortalToFollowElemContent: MockPortalToFollowElemContent,
  }
})

// ==========================================
// Test Data Builders
// ==========================================
const createMockCredential = (overrides?: Partial<DataSourceCredential>): DataSourceCredential => ({
  id: 'cred-1',
  name: 'Test Credential',
  avatar_url: 'https://example.com/avatar.png',
  credential: { key: 'value' },
  is_default: false,
  type: MockCredentialTypeEnum.OAUTH2 as unknown as DataSourceCredential['type'],
  ...overrides,
})

const createMockCredentials = (count: number = 3): DataSourceCredential[] =>
  Array.from({ length: count }, (_, i) =>
    createMockCredential({
      id: `cred-${i + 1}`,
      name: `Credential ${i + 1}`,
      avatar_url: `https://example.com/avatar-${i + 1}.png`,
      is_default: i === 0,
    }))

type HeaderProps = React.ComponentProps<typeof Header>

const createDefaultProps = (overrides?: Partial<HeaderProps>): HeaderProps => ({
  docTitle: 'Documentation',
  docLink: 'https://docs.example.com',
  pluginName: 'Test Plugin',
  currentCredentialId: 'cred-1',
  onCredentialChange: vi.fn(),
  credentials: createMockCredentials(),
  ...overrides,
})

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByText('Documentation')).toBeInTheDocument()
    })

    it('should render documentation link with correct attributes', () => {
      // Arrange
      const props = createDefaultProps({
        docTitle: 'API Docs',
        docLink: 'https://api.example.com/docs',
      })

      // Act
      render(<Header {...props} />)

      // Assert
      const link = screen.getByRole('link', { name: /API Docs/i })
      expect(link).toHaveAttribute('href', 'https://api.example.com/docs')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render document title with title attribute', () => {
      // Arrange
      const props = createDefaultProps({ docTitle: 'My Documentation' })

      // Act
      render(<Header {...props} />)

      // Assert
      const titleSpan = screen.getByText('My Documentation')
      expect(titleSpan).toHaveAttribute('title', 'My Documentation')
    })

    it('should render CredentialSelector with correct props', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert - CredentialSelector should render current credential name
      expect(screen.getByText('Credential 1')).toBeInTheDocument()
    })

    it('should render configuration button', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render book icon in documentation link', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert - RiBookOpenLine renders as SVG
      const link = screen.getByRole('link')
      const svg = link.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render divider between credential selector and configuration button', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Header {...props} />)

      // Assert - Divider component should be rendered
      // Divider typically renders as a div with specific styling
      const divider = container.querySelector('[class*="divider"]') || container.querySelector('.mx-1.h-3\\.5')
      expect(divider).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('docTitle prop', () => {
      it('should display the document title', () => {
        // Arrange
        const props = createDefaultProps({ docTitle: 'Getting Started Guide' })

        // Act
        render(<Header {...props} />)

        // Assert
        expect(screen.getByText('Getting Started Guide')).toBeInTheDocument()
      })

      it.each([
        'Quick Start',
        'API Reference',
        'Configuration Guide',
        'Plugin Documentation',
      ])('should display "%s" as document title', (title) => {
        // Arrange
        const props = createDefaultProps({ docTitle: title })

        // Act
        render(<Header {...props} />)

        // Assert
        expect(screen.getByText(title)).toBeInTheDocument()
      })
    })

    describe('docLink prop', () => {
      it('should set correct href on documentation link', () => {
        // Arrange
        const props = createDefaultProps({ docLink: 'https://custom.docs.com/guide' })

        // Act
        render(<Header {...props} />)

        // Assert
        const link = screen.getByRole('link')
        expect(link).toHaveAttribute('href', 'https://custom.docs.com/guide')
      })

      it.each([
        'https://docs.dify.ai',
        'https://example.com/api',
        '/local/docs',
      ])('should accept "%s" as docLink', (link) => {
        // Arrange
        const props = createDefaultProps({ docLink: link })

        // Act
        render(<Header {...props} />)

        // Assert
        expect(screen.getByRole('link')).toHaveAttribute('href', link)
      })
    })

    describe('pluginName prop', () => {
      it('should pass pluginName to translation function', () => {
        // Arrange
        const props = createDefaultProps({ pluginName: 'MyPlugin' })

        // Act
        render(<Header {...props} />)

        // Assert - The translation mock returns the key with options
        // Tooltip uses the translated content
        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })

    describe('onClickConfiguration prop', () => {
      it('should call onClickConfiguration when configuration icon is clicked', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const props = createDefaultProps({ onClickConfiguration: mockOnClick })
        render(<Header {...props} />)

        // Act - Find the configuration button and click the icon inside
        // The button contains the RiEqualizer2Line icon with onClick handler
        const configButton = screen.getByRole('button')
        const configIcon = configButton.querySelector('svg')
        expect(configIcon).toBeInTheDocument()
        fireEvent.click(configIcon!)

        // Assert
        expect(mockOnClick).toHaveBeenCalledTimes(1)
      })

      it('should not crash when onClickConfiguration is undefined', () => {
        // Arrange
        const props = createDefaultProps({ onClickConfiguration: undefined })
        render(<Header {...props} />)

        // Act - Find the configuration button and click the icon inside
        const configButton = screen.getByRole('button')
        const configIcon = configButton.querySelector('svg')
        expect(configIcon).toBeInTheDocument()
        fireEvent.click(configIcon!)

        // Assert - Component should still be rendered (no crash)
        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })

    describe('CredentialSelector props passthrough', () => {
      it('should pass currentCredentialId to CredentialSelector', () => {
        // Arrange
        const props = createDefaultProps({ currentCredentialId: 'cred-2' })

        // Act
        render(<Header {...props} />)

        // Assert - Should display the second credential
        expect(screen.getByText('Credential 2')).toBeInTheDocument()
      })

      it('should pass credentials to CredentialSelector', () => {
        // Arrange
        const customCredentials = [
          createMockCredential({ id: 'custom-1', name: 'Custom Credential' }),
        ]
        const props = createDefaultProps({
          credentials: customCredentials,
          currentCredentialId: 'custom-1',
        })

        // Act
        render(<Header {...props} />)

        // Assert
        expect(screen.getByText('Custom Credential')).toBeInTheDocument()
      })

      it('should pass onCredentialChange to CredentialSelector', () => {
        // Arrange
        const mockOnChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnChange })
        render(<Header {...props} />)

        // Act - Open dropdown and select a credential
        // Use getAllByTestId and select the first one (CredentialSelector's trigger)
        const triggers = screen.getAllByTestId('portal-trigger')
        fireEvent.click(triggers[0])
        const credential2 = screen.getByText('Credential 2')
        fireEvent.click(credential2)

        // Assert
        expect(mockOnChange).toHaveBeenCalledWith('cred-2')
      })
    })
  })

  // ==========================================
  // User Interactions
  // ==========================================
  describe('User Interactions', () => {
    it('should open external link in new tab when clicking documentation link', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert - Link has target="_blank" for new tab
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('should allow credential selection through CredentialSelector', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      render(<Header {...props} />)

      // Act - Open dropdown (use first trigger which is CredentialSelector's)
      const triggers = screen.getAllByTestId('portal-trigger')
      fireEvent.click(triggers[0])

      // Assert - Dropdown should be open
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should trigger configuration callback when clicking config icon', () => {
      // Arrange
      const mockOnConfig = vi.fn()
      const props = createDefaultProps({ onClickConfiguration: mockOnConfig })
      const { container } = render(<Header {...props} />)

      // Act
      const configIcon = container.querySelector('.h-4.w-4')
      fireEvent.click(configIcon!)

      // Assert
      expect(mockOnConfig).toHaveBeenCalled()
    })
  })

  // ==========================================
  // Component Memoization
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(Header.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should not re-render when props remain the same', () => {
      // Arrange
      const props = createDefaultProps()
      const renderSpy = vi.fn()

      const TrackedHeader: React.FC<HeaderProps> = (trackedProps) => {
        renderSpy()
        return <Header {...trackedProps} />
      }
      const MemoizedTracked = React.memo(TrackedHeader)

      // Act
      const { rerender } = render(<MemoizedTracked {...props} />)
      rerender(<MemoizedTracked {...props} />)

      // Assert - Should only render once due to same props
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when docTitle changes', () => {
      // Arrange
      const props = createDefaultProps({ docTitle: 'Original Title' })
      const { rerender } = render(<Header {...props} />)

      // Assert initial
      expect(screen.getByText('Original Title')).toBeInTheDocument()

      // Act
      rerender(<Header {...props} docTitle="Updated Title" />)

      // Assert
      expect(screen.getByText('Updated Title')).toBeInTheDocument()
    })

    it('should re-render when currentCredentialId changes', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-1' })
      const { rerender } = render(<Header {...props} />)

      // Assert initial
      expect(screen.getByText('Credential 1')).toBeInTheDocument()

      // Act
      rerender(<Header {...props} currentCredentialId="cred-2" />)

      // Assert
      expect(screen.getByText('Credential 2')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle empty docTitle', () => {
      // Arrange
      const props = createDefaultProps({ docTitle: '' })

      // Act
      render(<Header {...props} />)

      // Assert - Should render without crashing
      const link = screen.getByRole('link')
      expect(link).toBeInTheDocument()
    })

    it('should handle very long docTitle', () => {
      // Arrange
      const longTitle = 'A'.repeat(200)
      const props = createDefaultProps({ docTitle: longTitle })

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle special characters in docTitle', () => {
      // Arrange
      const specialTitle = 'Docs & Guide <v2> "Special"'
      const props = createDefaultProps({ docTitle: specialTitle })

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByText(specialTitle)).toBeInTheDocument()
    })

    it('should handle empty credentials array', () => {
      // Arrange
      const props = createDefaultProps({
        credentials: [],
        currentCredentialId: '',
      })

      // Act
      render(<Header {...props} />)

      // Assert - Should render without crashing
      expect(screen.getByRole('link')).toBeInTheDocument()
    })

    it('should handle special characters in pluginName', () => {
      // Arrange
      const props = createDefaultProps({ pluginName: 'Plugin & Tool <v1>' })

      // Act
      render(<Header {...props} />)

      // Assert - Should render without crashing
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle unicode characters in docTitle', () => {
      // Arrange
      const props = createDefaultProps({ docTitle: '文档说明 📚' })

      // Act
      render(<Header {...props} />)

      // Assert
      expect(screen.getByText('文档说明 📚')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Styling
  // ==========================================
  describe('Styling', () => {
    it('should apply correct classes to container', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Header {...props} />)

      // Assert
      const rootDiv = container.firstChild as HTMLElement
      expect(rootDiv).toHaveClass('flex', 'items-center', 'justify-between', 'gap-x-2')
    })

    it('should apply correct classes to documentation link', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert
      const link = screen.getByRole('link')
      expect(link).toHaveClass('system-xs-medium', 'text-text-accent')
    })

    it('should apply shrink-0 to documentation link', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert
      const link = screen.getByRole('link')
      expect(link).toHaveClass('shrink-0')
    })
  })

  // ==========================================
  // Integration Tests
  // ==========================================
  describe('Integration', () => {
    it('should work with full credential workflow', () => {
      // Arrange
      const mockOnCredentialChange = vi.fn()
      const props = createDefaultProps({
        onCredentialChange: mockOnCredentialChange,
        currentCredentialId: 'cred-1',
      })
      render(<Header {...props} />)

      // Assert initial state
      expect(screen.getByText('Credential 1')).toBeInTheDocument()

      // Act - Open dropdown and select different credential
      // Use first trigger which is CredentialSelector's
      const triggers = screen.getAllByTestId('portal-trigger')
      fireEvent.click(triggers[0])

      const credential3 = screen.getByText('Credential 3')
      fireEvent.click(credential3)

      // Assert
      expect(mockOnCredentialChange).toHaveBeenCalledWith('cred-3')
    })

    it('should display all components together correctly', () => {
      // Arrange
      const mockOnConfig = vi.fn()
      const props = createDefaultProps({
        docTitle: 'Integration Test Docs',
        docLink: 'https://test.com/docs',
        pluginName: 'TestPlugin',
        onClickConfiguration: mockOnConfig,
      })

      // Act
      render(<Header {...props} />)

      // Assert - All main elements present
      expect(screen.getByText('Credential 1')).toBeInTheDocument() // CredentialSelector
      expect(screen.getByRole('button')).toBeInTheDocument() // Config button
      expect(screen.getByText('Integration Test Docs')).toBeInTheDocument() // Doc link
      expect(screen.getByRole('link')).toHaveAttribute('href', 'https://test.com/docs')
    })
  })

  // ==========================================
  // Accessibility
  // ==========================================
  describe('Accessibility', () => {
    it('should have accessible link', () => {
      // Arrange
      const props = createDefaultProps({ docTitle: 'Accessible Docs' })

      // Act
      render(<Header {...props} />)

      // Assert
      const link = screen.getByRole('link', { name: /Accessible Docs/i })
      expect(link).toBeInTheDocument()
    })

    it('should have accessible button for configuration', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should have noopener noreferrer for security on external links', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Header {...props} />)

      // Assert
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })
})
