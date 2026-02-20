import type { DataSourceCredential } from './types'
import { fireEvent, render, screen } from '@testing-library/react'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Operator from './operator'

/**
 * Operator Component Tests
 * Using Unit approach with mocked Dropdown to isolate item rendering logic.
 */

// Helper to open dropdown
const openDropdown = () => {
  fireEvent.click(screen.getByRole('button'))
}

describe('Operator Component', () => {
  const mockOnAction = vi.fn()
  const mockOnRename = vi.fn()

  const createMockCredential = (type: CredentialTypeEnum): DataSourceCredential => ({
    id: 'test-id',
    name: 'Test Credential',
    credential: {},
    type,
    is_default: false,
    avatar_url: '',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Conditional Action Rendering', () => {
    it('should render correct actions for API_KEY type', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)

      // Act
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)
      openDropdown()

      // Assert
      expect(await screen.findByText('plugin.auth.setDefault')).toBeInTheDocument()
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.rename')).not.toBeInTheDocument()
      expect(screen.queryByText('common.dataSource.notion.changeAuthorizedPages')).not.toBeInTheDocument()
    })

    it('should render correct actions for OAUTH2 type', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)

      // Act
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)
      openDropdown()

      // Assert
      expect(await screen.findByText('plugin.auth.setDefault')).toBeInTheDocument()
      expect(screen.getByText('common.operation.rename')).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.changeAuthorizedPages')).toBeInTheDocument()
      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
    })
  })

  describe('Action Callbacks', () => {
    it('should call onRename when "rename" action is selected', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

      // Act
      openDropdown()
      fireEvent.click(await screen.findByText('common.operation.rename'))

      // Assert
      expect(mockOnRename).toHaveBeenCalledTimes(1)
      expect(mockOnAction).not.toHaveBeenCalled()
    })

    it('should handle missing onRename gracefully when "rename" action is selected', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
      render(<Operator credentialItem={credential} onAction={mockOnAction} />)

      // Act & Assert
      openDropdown()
      const renameBtn = await screen.findByText('common.operation.rename')
      expect(() => fireEvent.click(renameBtn)).not.toThrow()
    })

    it('should call onAction for "setDefault" action', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

      // Act
      openDropdown()
      fireEvent.click(await screen.findByText('plugin.auth.setDefault'))

      // Assert
      expect(mockOnAction).toHaveBeenCalledWith('setDefault', credential)
    })

    it('should call onAction for "edit" action', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

      // Act
      openDropdown()
      fireEvent.click(await screen.findByText('common.operation.edit'))

      // Assert
      expect(mockOnAction).toHaveBeenCalledWith('edit', credential)
    })

    it('should call onAction for "change" action', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

      // Act
      openDropdown()
      fireEvent.click(await screen.findByText('common.dataSource.notion.changeAuthorizedPages'))

      // Assert
      expect(mockOnAction).toHaveBeenCalledWith('change', credential)
    })

    it('should call onAction for "delete" action', async () => {
      // Arrange
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(<Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />)

      // Act
      openDropdown()
      fireEvent.click(await screen.findByText('common.operation.remove'))

      // Assert
      expect(mockOnAction).toHaveBeenCalledWith('delete', credential)
    })
  })
})
