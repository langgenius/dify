import type { DataSourceCredential } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Item from './item'

/**
 * Item Component Tests
 * Using Unit approach to focus on the renaming logic and view state.
 */

// Helper to trigger rename via the real Operator component's dropdown
const triggerRename = async () => {
  const dropdownTrigger = screen.getByRole('button')
  fireEvent.click(dropdownTrigger)
  const renameOption = await screen.findByText('common.operation.rename')
  fireEvent.click(renameOption)
}

describe('Item Component', () => {
  const mockOnAction = vi.fn()
  const mockCredentialItem: DataSourceCredential = {
    id: 'test-id',
    name: 'Test Credential',
    credential: {},
    type: CredentialTypeEnum.OAUTH2,
    is_default: false,
    avatar_url: '',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial View Mode', () => {
    it('should render the credential name and "connected" status', () => {
      // Act
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

      // Assert
      expect(screen.getByText('Test Credential')).toBeInTheDocument()
      expect(screen.getByText('connected')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument() // Dropdown trigger
    })
  })

  describe('Rename Mode Interactions', () => {
    it('should switch to rename mode when Trigger Rename is clicked', async () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

      // Act
      await triggerRename()
      expect(screen.getByPlaceholderText('common.placeholder.input')).toBeInTheDocument()
      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    })

    it('should update rename input value when changed', async () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)
      await triggerRename()
      const input = screen.getByPlaceholderText('common.placeholder.input')

      // Act
      fireEvent.change(input, { target: { value: 'Updated Name' } })

      // Assert
      expect(input).toHaveValue('Updated Name')
    })

    it('should call onAction with "rename" and correct payload when Save is clicked', async () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)
      await triggerRename()
      const input = screen.getByPlaceholderText('common.placeholder.input')
      fireEvent.change(input, { target: { value: 'New Name' } })

      // Act
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      expect(mockOnAction).toHaveBeenCalledWith(
        'rename',
        mockCredentialItem,
        {
          credential_id: 'test-id',
          name: 'New Name',
        },
      )
      // Should switch back to view mode
      expect(screen.queryByPlaceholderText('common.placeholder.input')).not.toBeInTheDocument()
      expect(screen.getByText('Test Credential')).toBeInTheDocument()
    })

    it('should exit rename mode without calling onAction when Cancel is clicked', async () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)
      await triggerRename()
      const input = screen.getByPlaceholderText('common.placeholder.input')
      fireEvent.change(input, { target: { value: 'Cancelled Name' } })

      // Act
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(mockOnAction).not.toHaveBeenCalled()
      // Should switch back to view mode
      expect(screen.queryByPlaceholderText('common.placeholder.input')).not.toBeInTheDocument()
      expect(screen.getByText('Test Credential')).toBeInTheDocument()
    })
  })

  describe('Event Bubbling', () => {
    it('should stop event propagation when interacting with rename mode elements', async () => {
      // Arrange
      const parentClick = vi.fn()
      render(
        <div onClick={parentClick}>
          <Item credentialItem={mockCredentialItem} onAction={mockOnAction} />
        </div>,
      )
      // Act & Assert
      // We need to enter rename mode first
      await triggerRename()
      parentClick.mockClear()

      fireEvent.click(screen.getByPlaceholderText('common.placeholder.input'))
      expect(parentClick).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('common.operation.save'))
      expect(parentClick).not.toHaveBeenCalled()

      // Re-enter rename mode for cancel test
      await triggerRename()
      parentClick.mockClear()

      fireEvent.click(screen.getByText('common.operation.cancel'))
      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should not throw if onAction is missing', async () => {
      // Arrange & Act
      // @ts-expect-error - Testing runtime tolerance for missing prop
      render(<Item credentialItem={mockCredentialItem} onAction={undefined} />)
      await triggerRename()

      // Assert
      expect(() => fireEvent.click(screen.getByText('common.operation.save'))).not.toThrow()
    })
  })
})
