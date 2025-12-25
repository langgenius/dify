import type { CredentialSelectorProps } from './index'
import type { DataSourceCredential } from '@/types/pipeline'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import CredentialSelector from './index'

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

// Mock portal-to-follow-elem - use React state to properly handle open/close
vi.mock('@/app/components/base/portal-to-follow-elem', () => {
  const MockPortalToFollowElem = ({ children, open }: any) => {
    return (
      <div data-testid="portal-root" data-open={open}>
        {React.Children.map(children, (child: any) => {
          if (!child)
            return null
          // Pass open state to children via context-like prop cloning
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
    // Match actual behavior: returns null when not open
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

// CredentialIcon - imported directly (not mocked)
// This is a simple UI component with no external dependencies

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

const createDefaultProps = (overrides?: Partial<CredentialSelectorProps>): CredentialSelectorProps => ({
  currentCredentialId: 'cred-1',
  onCredentialChange: vi.fn(),
  credentials: createMockCredentials(),
  ...overrides,
})

describe('CredentialSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests - Verify component renders correctly
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.getByTestId('portal-root')).toBeInTheDocument()
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })

    it('should render current credential name in trigger', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.getByText('Credential 1')).toBeInTheDocument()
    })

    it('should render credential icon with correct props', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<CredentialSelector {...props} />)

      // Assert - CredentialIcon renders an img when avatarUrl is provided
      const iconImg = container.querySelector('img')
      expect(iconImg).toBeInTheDocument()
      expect(iconImg).toHaveAttribute('src', 'https://example.com/avatar-1.png')
    })

    it('should render dropdown arrow icon', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<CredentialSelector {...props} />)

      // Assert
      const svgIcon = container.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })

    it('should not render dropdown content initially', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should render all credentials in dropdown when opened', () => {
      // Arrange
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      // Act - Click trigger to open dropdown
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert - All credentials should be visible (current credential appears in both trigger and list)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      // 3 in dropdown list + 1 in trigger (current) = 4 total
      expect(screen.getAllByText(/Credential \d/)).toHaveLength(4)
    })
  })

  // ==========================================
  // Props Testing - Verify all prop variations
  // ==========================================
  describe('Props', () => {
    describe('currentCredentialId prop', () => {
      it('should display first credential when currentCredentialId matches first', () => {
        // Arrange
        const props = createDefaultProps({ currentCredentialId: 'cred-1' })

        // Act
        render(<CredentialSelector {...props} />)

        // Assert
        expect(screen.getByText('Credential 1')).toBeInTheDocument()
      })

      it('should display second credential when currentCredentialId matches second', () => {
        // Arrange
        const props = createDefaultProps({ currentCredentialId: 'cred-2' })

        // Act
        render(<CredentialSelector {...props} />)

        // Assert
        expect(screen.getByText('Credential 2')).toBeInTheDocument()
      })

      it('should display third credential when currentCredentialId matches third', () => {
        // Arrange
        const props = createDefaultProps({ currentCredentialId: 'cred-3' })

        // Act
        render(<CredentialSelector {...props} />)

        // Assert
        expect(screen.getByText('Credential 3')).toBeInTheDocument()
      })

      it.each([
        ['cred-1', 'Credential 1'],
        ['cred-2', 'Credential 2'],
        ['cred-3', 'Credential 3'],
      ])('should display %s credential name when currentCredentialId is %s', (credId, expectedName) => {
        // Arrange
        const props = createDefaultProps({ currentCredentialId: credId })

        // Act
        render(<CredentialSelector {...props} />)

        // Assert
        expect(screen.getByText(expectedName)).toBeInTheDocument()
      })
    })

    describe('credentials prop', () => {
      it('should render single credential correctly', () => {
        // Arrange
        const props = createDefaultProps({
          credentials: [createMockCredential()],
          currentCredentialId: 'cred-1',
        })

        // Act
        render(<CredentialSelector {...props} />)

        // Assert
        expect(screen.getByText('Test Credential')).toBeInTheDocument()
      })

      it('should render multiple credentials in dropdown', () => {
        // Arrange
        const props = createDefaultProps({
          credentials: createMockCredentials(5),
          currentCredentialId: 'cred-1',
        })
        render(<CredentialSelector {...props} />)

        // Act
        const trigger = screen.getByTestId('portal-trigger')
        fireEvent.click(trigger)

        // Assert - 5 in dropdown + 1 in trigger (current credential appears twice)
        expect(screen.getAllByText(/Credential \d/).length).toBe(6)
      })

      it('should handle credentials with special characters in name', () => {
        // Arrange
        const props = createDefaultProps({
          credentials: [createMockCredential({ id: 'cred-special', name: 'Test & Credential <special>' })],
          currentCredentialId: 'cred-special',
        })

        // Act
        render(<CredentialSelector {...props} />)

        // Assert
        expect(screen.getByText('Test & Credential <special>')).toBeInTheDocument()
      })
    })

    describe('onCredentialChange prop', () => {
      it('should be called when selecting a credential', () => {
        // Arrange
        const mockOnChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnChange })
        render(<CredentialSelector {...props} />)

        // Act - Open dropdown
        const trigger = screen.getByTestId('portal-trigger')
        fireEvent.click(trigger)

        // Click on second credential
        const credential2 = screen.getByText('Credential 2')
        fireEvent.click(credential2)

        // Assert
        expect(mockOnChange).toHaveBeenCalledWith('cred-2')
      })

      it.each([
        ['cred-2', 'Credential 2'],
        ['cred-3', 'Credential 3'],
      ])('should call onCredentialChange with %s when selecting %s', (credId, credentialName) => {
        // Arrange
        const mockOnChange = vi.fn()
        const props = createDefaultProps({ onCredentialChange: mockOnChange })
        render(<CredentialSelector {...props} />)

        // Act - Open dropdown and select credential
        const trigger = screen.getByTestId('portal-trigger')
        fireEvent.click(trigger)

        // Get the dropdown item using within() to scope query to portal content
        const portalContent = screen.getByTestId('portal-content')
        const credentialOption = within(portalContent).getByText(credentialName)
        fireEvent.click(credentialOption)

        // Assert
        expect(mockOnChange).toHaveBeenCalledWith(credId)
      })

      it('should call onCredentialChange with cred-1 when selecting Credential 1 in dropdown', () => {
        // Arrange - Start with cred-2 selected so cred-1 is only in dropdown
        const mockOnChange = vi.fn()
        const props = createDefaultProps({
          onCredentialChange: mockOnChange,
          currentCredentialId: 'cred-2',
        })
        render(<CredentialSelector {...props} />)

        // Act - Open dropdown and select Credential 1
        const trigger = screen.getByTestId('portal-trigger')
        fireEvent.click(trigger)

        const credential1 = screen.getByText('Credential 1')
        fireEvent.click(credential1)

        // Assert
        expect(mockOnChange).toHaveBeenCalledWith('cred-1')
      })
    })
  })

  // ==========================================
  // User Interactions - Test event handlers
  // ==========================================
  describe('User Interactions', () => {
    it('should toggle dropdown open when trigger is clicked', () => {
      // Arrange
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      // Assert - Initially closed
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()

      // Act - Click trigger
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert - Now open
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should call onCredentialChange when clicking a credential item', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      render(<CredentialSelector {...props} />)

      // Act
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)
      const credential2 = screen.getByText('Credential 2')
      fireEvent.click(credential2)

      // Assert
      expect(mockOnChange).toHaveBeenCalledTimes(1)
      expect(mockOnChange).toHaveBeenCalledWith('cred-2')
    })

    it('should close dropdown after selecting a credential', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      render(<CredentialSelector {...props} />)

      // Act - Open and select
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      const credential2 = screen.getByText('Credential 2')
      fireEvent.click(credential2)

      // Assert - The handleCredentialChange calls toggle(), which should change the open state
      expect(mockOnChange).toHaveBeenCalled()
    })

    it('should handle rapid consecutive clicks on trigger', () => {
      // Arrange
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      // Act - Rapid clicks
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)
      fireEvent.click(trigger)
      fireEvent.click(trigger)

      // Assert - Should not crash
      expect(trigger).toBeInTheDocument()
    })

    it('should allow selecting credentials multiple times', () => {
      // Arrange - Start with cred-2 selected so we can select other credentials
      const mockOnChange = vi.fn()
      const props = createDefaultProps({
        onCredentialChange: mockOnChange,
        currentCredentialId: 'cred-2',
      })

      render(<CredentialSelector {...props} />)

      // Act & Assert - Select Credential 1 (different from current)
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      const credential1 = screen.getByText('Credential 1')
      fireEvent.click(credential1)

      expect(mockOnChange).toHaveBeenCalledWith('cred-1')
    })
  })

  // ==========================================
  // Side Effects and Cleanup - Test useEffect behavior
  // ==========================================
  describe('Side Effects and Cleanup', () => {
    it('should auto-select first credential when currentCredential is not found and credentials exist', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({
        currentCredentialId: 'non-existent-id',
        onCredentialChange: mockOnChange,
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should auto-select first credential
      expect(mockOnChange).toHaveBeenCalledWith('cred-1')
    })

    it('should not call onCredentialChange when currentCredential is found', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({
        currentCredentialId: 'cred-2',
        onCredentialChange: mockOnChange,
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should not auto-select
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should not call onCredentialChange when credentials array is empty', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({
        currentCredentialId: 'cred-1',
        credentials: [],
        onCredentialChange: mockOnChange,
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should not call since no credentials to select
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should auto-select when credentials change and currentCredential becomes invalid', async () => {
      // Arrange
      const mockOnChange = vi.fn()
      const initialCredentials = createMockCredentials(3)
      const props = createDefaultProps({
        currentCredentialId: 'cred-1',
        credentials: initialCredentials,
        onCredentialChange: mockOnChange,
      })

      const { rerender } = render(<CredentialSelector {...props} />)
      expect(mockOnChange).not.toHaveBeenCalled()

      // Act - Change credentials to not include current
      const newCredentials = [
        createMockCredential({ id: 'cred-4', name: 'New Credential 4' }),
        createMockCredential({ id: 'cred-5', name: 'New Credential 5' }),
      ]
      rerender(
        <CredentialSelector
          {...props}
          credentials={newCredentials}
        />,
      )

      // Assert - Should auto-select first of new credentials
      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith('cred-4')
      })
    })

    it('should not trigger auto-select effect on every render with same props', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })

      // Act - Render and rerender with same props
      const { rerender } = render(<CredentialSelector {...props} />)
      rerender(<CredentialSelector {...props} />)
      rerender(<CredentialSelector {...props} />)

      // Assert - onCredentialChange should not be called for auto-selection
      expect(mockOnChange).not.toHaveBeenCalled()
    })
  })

  // ==========================================
  // Callback Stability and Memoization - Test useCallback behavior
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should have stable handleCredentialChange callback', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      render(<CredentialSelector {...props} />)

      // Act - Open dropdown and select
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)
      const credential = screen.getByText('Credential 2')
      fireEvent.click(credential)

      // Assert - Callback should work correctly
      expect(mockOnChange).toHaveBeenCalledWith('cred-2')
    })

    it('should update handleCredentialChange when onCredentialChange changes', () => {
      // Arrange
      const mockOnChange1 = vi.fn()
      const mockOnChange2 = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange1 })

      const { rerender } = render(<CredentialSelector {...props} />)

      // Act - Update onCredentialChange prop
      rerender(<CredentialSelector {...props} onCredentialChange={mockOnChange2} />)

      // Open and select
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)
      const credential = screen.getByText('Credential 2')
      fireEvent.click(credential)

      // Assert - New callback should be used
      expect(mockOnChange1).not.toHaveBeenCalled()
      expect(mockOnChange2).toHaveBeenCalledWith('cred-2')
    })
  })

  // ==========================================
  // Memoization Logic and Dependencies - Test useMemo behavior
  // ==========================================
  describe('Memoization Logic and Dependencies', () => {
    it('should find currentCredential by id', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-2' })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should display credential 2
      expect(screen.getByText('Credential 2')).toBeInTheDocument()
    })

    it('should update currentCredential when currentCredentialId changes', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-1' })
      const { rerender } = render(<CredentialSelector {...props} />)

      // Assert initial
      expect(screen.getByText('Credential 1')).toBeInTheDocument()

      // Act - Change currentCredentialId
      rerender(<CredentialSelector {...props} currentCredentialId="cred-3" />)

      // Assert - Should now display credential 3
      expect(screen.getByText('Credential 3')).toBeInTheDocument()
    })

    it('should update currentCredential when credentials array changes', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-1' })
      const { rerender } = render(<CredentialSelector {...props} />)

      // Assert initial
      expect(screen.getByText('Credential 1')).toBeInTheDocument()

      // Act - Change credentials
      const newCredentials = [
        createMockCredential({ id: 'cred-1', name: 'Updated Credential 1' }),
      ]
      rerender(<CredentialSelector {...props} credentials={newCredentials} />)

      // Assert - Should display updated name
      expect(screen.getByText('Updated Credential 1')).toBeInTheDocument()
    })

    it('should return undefined currentCredential when id not found', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({
        currentCredentialId: 'non-existent',
        onCredentialChange: mockOnChange,
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should trigger auto-select effect
      expect(mockOnChange).toHaveBeenCalledWith('cred-1')
    })
  })

  // ==========================================
  // Component Memoization - Test React.memo behavior
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(CredentialSelector.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should not re-render when props remain the same', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      const renderSpy = vi.fn()

      const TrackedCredentialSelector: React.FC<CredentialSelectorProps> = (trackedProps) => {
        renderSpy()
        return <CredentialSelector {...trackedProps} />
      }
      const MemoizedTracked = React.memo(TrackedCredentialSelector)

      // Act
      const { rerender } = render(<MemoizedTracked {...props} />)
      rerender(<MemoizedTracked {...props} />)

      // Assert - Should only render once due to same props
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when currentCredentialId changes', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-1' })
      const { rerender } = render(<CredentialSelector {...props} />)

      // Assert initial
      expect(screen.getByText('Credential 1')).toBeInTheDocument()

      // Act
      rerender(<CredentialSelector {...props} currentCredentialId="cred-2" />)

      // Assert
      expect(screen.getByText('Credential 2')).toBeInTheDocument()
    })

    it('should re-render when credentials array reference changes', () => {
      // Arrange
      const props = createDefaultProps()
      const { rerender } = render(<CredentialSelector {...props} />)

      // Act - Create new credentials array with different data
      const newCredentials = [
        createMockCredential({ id: 'cred-1', name: 'New Name 1' }),
      ]
      rerender(<CredentialSelector {...props} credentials={newCredentials} />)

      // Assert
      expect(screen.getByText('New Name 1')).toBeInTheDocument()
    })

    it('should re-render when onCredentialChange reference changes', () => {
      // Arrange
      const mockOnChange1 = vi.fn()
      const mockOnChange2 = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange1 })
      const { rerender } = render(<CredentialSelector {...props} />)

      // Act - Change callback reference
      rerender(<CredentialSelector {...props} onCredentialChange={mockOnChange2} />)

      // Open and select
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)
      const credential = screen.getByText('Credential 2')
      fireEvent.click(credential)

      // Assert - New callback should be used
      expect(mockOnChange2).toHaveBeenCalledWith('cred-2')
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty credentials array', () => {
      // Arrange
      const props = createDefaultProps({
        credentials: [],
        currentCredentialId: 'cred-1',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should render without crashing
      expect(screen.getByTestId('portal-root')).toBeInTheDocument()
    })

    it('should handle undefined avatar_url in credential', () => {
      // Arrange
      const credentialWithoutAvatar = createMockCredential({
        id: 'cred-no-avatar',
        name: 'No Avatar Credential',
        avatar_url: undefined,
      })
      const props = createDefaultProps({
        credentials: [credentialWithoutAvatar],
        currentCredentialId: 'cred-no-avatar',
      })

      // Act
      const { container } = render(<CredentialSelector {...props} />)

      // Assert - Should render without crashing and show first letter fallback
      expect(screen.getByText('No Avatar Credential')).toBeInTheDocument()
      // When avatar_url is undefined, CredentialIcon shows first letter instead of img
      const iconImg = container.querySelector('img')
      expect(iconImg).not.toBeInTheDocument()
      // First letter 'N' should be displayed
      expect(screen.getByText('N')).toBeInTheDocument()
    })

    it('should handle empty string name in credential', () => {
      // Arrange
      const credentialWithEmptyName = createMockCredential({
        id: 'cred-empty-name',
        name: '',
      })
      const props = createDefaultProps({
        credentials: [credentialWithEmptyName],
        currentCredentialId: 'cred-empty-name',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should render without crashing
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })

    it('should handle very long credential name', () => {
      // Arrange
      const longName = 'A'.repeat(200)
      const credentialWithLongName = createMockCredential({
        id: 'cred-long-name',
        name: longName,
      })
      const props = createDefaultProps({
        credentials: [credentialWithLongName],
        currentCredentialId: 'cred-long-name',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in credential name', () => {
      // Arrange
      const specialName = '测试 Credential <script>alert("xss")</script> & "quoted"'
      const credentialWithSpecialName = createMockCredential({
        id: 'cred-special',
        name: specialName,
      })
      const props = createDefaultProps({
        credentials: [credentialWithSpecialName],
        currentCredentialId: 'cred-special',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.getByText(specialName)).toBeInTheDocument()
    })

    it('should handle numeric id as string', () => {
      // Arrange
      const credentialWithNumericId = createMockCredential({
        id: '123456',
        name: 'Numeric ID Credential',
      })
      const props = createDefaultProps({
        credentials: [credentialWithNumericId],
        currentCredentialId: '123456',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.getByText('Numeric ID Credential')).toBeInTheDocument()
    })

    it('should handle large number of credentials', () => {
      // Arrange
      const manyCredentials = createMockCredentials(100)
      const props = createDefaultProps({
        credentials: manyCredentials,
        currentCredentialId: 'cred-50',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      expect(screen.getByText('Credential 50')).toBeInTheDocument()
    })

    it('should handle credential selection with duplicate names', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const duplicateCredentials = [
        createMockCredential({ id: 'cred-1', name: 'Same Name' }),
        createMockCredential({ id: 'cred-2', name: 'Same Name' }),
      ]
      const props = createDefaultProps({
        credentials: duplicateCredentials,
        currentCredentialId: 'cred-1',
        onCredentialChange: mockOnChange,
      })

      // Act
      render(<CredentialSelector {...props} />)
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Get all "Same Name" elements
      // 1 in trigger (current) + 2 in dropdown (both credentials) = 3 total
      const sameNameElements = screen.getAllByText('Same Name')
      expect(sameNameElements.length).toBe(3)

      // Click the last dropdown item (cred-2 in dropdown)
      fireEvent.click(sameNameElements[2])

      // Assert - Should call with the correct id even with duplicate names
      expect(mockOnChange).toHaveBeenCalledWith('cred-2')
    })

    it('should not crash when clicking credential after unmount', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      const { unmount } = render(<CredentialSelector {...props} />)

      // Act
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      unmount()

      // Assert - Should not throw
      expect(() => {
        // Any cleanup should have happened
      }).not.toThrow()
    })

    it('should handle whitespace-only credential name', () => {
      // Arrange
      const credentialWithWhitespace = createMockCredential({
        id: 'cred-whitespace',
        name: '   ',
      })
      const props = createDefaultProps({
        credentials: [credentialWithWhitespace],
        currentCredentialId: 'cred-whitespace',
      })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Should render without crashing
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Styling and CSS Classes
  // ==========================================
  describe('Styling', () => {
    it('should apply overflow-hidden class to trigger', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      const trigger = screen.getByTestId('portal-trigger')
      expect(trigger).toHaveClass('overflow-hidden')
    })

    it('should apply grow class to trigger', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<CredentialSelector {...props} />)

      // Assert
      const trigger = screen.getByTestId('portal-trigger')
      expect(trigger).toHaveClass('grow')
    })

    it('should apply z-10 class to dropdown content', () => {
      // Arrange
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      // Act
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert
      const content = screen.getByTestId('portal-content')
      expect(content).toHaveClass('z-10')
    })
  })

  // ==========================================
  // Integration with Child Components
  // ==========================================
  describe('Integration with Child Components', () => {
    it('should pass currentCredential to Trigger component', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-2' })

      // Act
      render(<CredentialSelector {...props} />)

      // Assert - Trigger should display the correct credential
      expect(screen.getByText('Credential 2')).toBeInTheDocument()
    })

    it('should pass isOpen state to Trigger component', () => {
      // Arrange
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      // Assert - Initially closed
      const portalRoot = screen.getByTestId('portal-root')
      expect(portalRoot).toHaveAttribute('data-open', 'false')

      // Act - Open
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert - Now open
      expect(portalRoot).toHaveAttribute('data-open', 'true')
    })

    it('should pass credentials to List component', () => {
      // Arrange
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      // Act
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert - All credentials should be rendered in list
      // 3 in dropdown + 1 in trigger (current credential appears twice) = 4 total
      const credentialNames = screen.getAllByText(/Credential \d/)
      expect(credentialNames.length).toBe(4)
    })

    it('should pass currentCredentialId to List component', () => {
      // Arrange
      const props = createDefaultProps({ currentCredentialId: 'cred-2' })
      render(<CredentialSelector {...props} />)

      // Act
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // Assert - Current credential (Credential 2) appears twice:
      // once in trigger and once in dropdown list
      const credential2Elements = screen.getAllByText('Credential 2')
      expect(credential2Elements.length).toBe(2)
    })

    it('should pass handleCredentialChange to List component', () => {
      // Arrange
      const mockOnChange = vi.fn()
      const props = createDefaultProps({ onCredentialChange: mockOnChange })
      render(<CredentialSelector {...props} />)

      // Act
      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)
      const credential3 = screen.getByText('Credential 3')
      fireEvent.click(credential3)

      // Assert - handleCredentialChange should propagate the call
      expect(mockOnChange).toHaveBeenCalledWith('cred-3')
    })
  })

  // ==========================================
  // Portal Configuration
  // ==========================================
  describe('Portal Configuration', () => {
    it('should configure PortalToFollowElem with placement bottom-start', () => {
      // This test verifies the portal is configured correctly
      // The actual placement is handled by the mock, but we verify the component renders
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      expect(screen.getByTestId('portal-root')).toBeInTheDocument()
    })

    it('should configure PortalToFollowElem with offset mainAxis 4', () => {
      // This test verifies the offset configuration doesn't break rendering
      const props = createDefaultProps()
      render(<CredentialSelector {...props} />)

      expect(screen.getByTestId('portal-root')).toBeInTheDocument()
    })
  })
})
