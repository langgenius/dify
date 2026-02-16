import type { DataSourceCredential } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Item from './item'

/**
 * Item Component Tests
 * Using Unit approach to focus on the renaming logic and view state.
 */

// Mock the Operator component to isolate the Item component tests.
vi.mock('./operator', () => ({
  default: vi.fn(({ onRename }: { onRename: () => void }) => (
    <button data-testid="operator-rename" onClick={onRename}>
      Trigger Rename
    </button>
  )),
}))

describe('Item Component', () => {
  const mockOnAction = vi.fn()
  const mockCredentialItem: DataSourceCredential = {
    id: 'test-id',
    name: 'Test Credential',
    credential: {},
    type: CredentialTypeEnum.API_KEY,
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
      expect(screen.getByTestId('operator-rename')).toBeInTheDocument()
    })
  })

  describe('Rename Mode Interactions', () => {
    it('should switch to rename mode when Trigger Rename is clicked', () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)

      // Act
      fireEvent.click(screen.getByTestId('operator-rename'))

      // Assert
      expect(screen.queryByText('Test Credential')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.placeholder.input')).toBeInTheDocument()
      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    })

    it('should update rename input value when changed', () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)
      fireEvent.click(screen.getByTestId('operator-rename'))
      const input = screen.getByPlaceholderText('common.placeholder.input')

      // Act
      fireEvent.change(input, { target: { value: 'Updated Name' } })

      // Assert
      expect(input).toHaveValue('Updated Name')
    })

    it('should call onAction with "rename" and correct payload when Save is clicked', () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)
      fireEvent.click(screen.getByTestId('operator-rename'))
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

    it('should exit rename mode without calling onAction when Cancel is clicked', () => {
      // Arrange
      render(<Item credentialItem={mockCredentialItem} onAction={mockOnAction} />)
      fireEvent.click(screen.getByTestId('operator-rename'))
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
    it('should stop event propagation when interacting with rename mode elements', () => {
      // Arrange
      const parentClick = vi.fn()
      render(
        <div onClick={parentClick}>
          <Item credentialItem={mockCredentialItem} onAction={mockOnAction} />
        </div>,
      )
      fireEvent.click(screen.getByTestId('operator-rename'))
      parentClick.mockClear()

      // Act & Assert
      fireEvent.click(screen.getByPlaceholderText('common.placeholder.input'))
      expect(parentClick).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('common.operation.save'))
      expect(parentClick).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('operator-rename'))
      parentClick.mockClear()

      fireEvent.click(screen.getByText('common.operation.cancel'))
      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should not throw if onAction is missing', () => {
      // Arrange & Act
      // @ts-expect-error - Testing runtime tolerance for missing prop
      render(<Item credentialItem={mockCredentialItem} onAction={undefined} />)
      fireEvent.click(screen.getByTestId('operator-rename'))

      // Assert
      expect(() => fireEvent.click(screen.getByText('common.operation.save'))).not.toThrow()
    })
  })
})
