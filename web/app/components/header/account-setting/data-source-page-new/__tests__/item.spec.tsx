import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Item from '../item'

/**
 * Item Component Tests
 * Using Unit approach to focus on the renaming logic and view state.
 */

// Helper to trigger rename via the real Operator component's dropdown
const triggerRename = async (user: ReturnType<typeof userEvent.setup>) => {
  const dropdownTrigger = screen.getByRole('button')
  await user.click(dropdownTrigger)
  const renameOption = await screen.findByText('common.operation.rename')
  await user.click(renameOption)
  await waitFor(() => {
    expect(screen.getByPlaceholderText('common.placeholder.input')).toBeInTheDocument()
  })
}

describe('Item Component', () => {
  const mockOnAction = vi.fn()
  const mockCredentialItem: DatasourceCredentialResponse = {
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
      expect(screen.getByText('common.dataSource.notion.connected')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument() // Dropdown trigger
    })

    it('should render default badge without a leading avatar', () => {
      // Act
      render(
        <Item
          credentialItem={{
            ...mockCredentialItem,
            is_default: true,
            avatar_url: 'avatar-url',
          }}
          onAction={mockOnAction}
        />,
      )

      // Assert
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.getByText('plugin.auth.default')).toBeInTheDocument()
    })
  })

  describe('Rename Mode Interactions', () => {
    it.each(['save', 'cancel'])(
      'keeps keyboard focus in the credential row after %s',
      async (action) => {
        const user = userEvent.setup()
        render(
          <Item credentialItem={mockCredentialItem} onAction={mockOnAction} canManageCredential />,
        )

        await user.click(screen.getByRole('button'))
        await user.click(await screen.findByText('common.operation.rename'))

        const input = await screen.findByRole('textbox', {
          name: 'common.operation.rename Test Credential',
        })
        expect(input).toHaveFocus()

        await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
        await waitFor(() => {
          expect(
            screen.getByRole('button', { name: 'common.operation.more Test Credential' }),
          ).toHaveFocus()
        })
      },
    )

    it('should call onAction with "rename" and correct payload when Save is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(
        <Item credentialItem={mockCredentialItem} onAction={mockOnAction} canManageCredential />,
      )
      await triggerRename(user)
      const input = screen.getByPlaceholderText('common.placeholder.input')
      await user.clear(input)
      await user.type(input, 'New Name')

      // Act
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      expect(mockOnAction).toHaveBeenCalledWith('rename', mockCredentialItem, {
        credential_id: 'test-id',
        name: 'New Name',
      })
      // Should switch back to view mode
      expect(screen.queryByPlaceholderText('common.placeholder.input')).not.toBeInTheDocument()
      expect(screen.getByText('Test Credential')).toBeInTheDocument()
    })

    it('should exit rename mode without calling onAction when Cancel is clicked', async () => {
      const user = userEvent.setup()
      // Arrange
      render(
        <Item credentialItem={mockCredentialItem} onAction={mockOnAction} canManageCredential />,
      )
      await triggerRename(user)
      const input = screen.getByPlaceholderText('common.placeholder.input')
      await user.clear(input)
      await user.type(input, 'Cancelled Name')

      // Act
      await user.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(mockOnAction).not.toHaveBeenCalled()
      // Should switch back to view mode
      expect(screen.queryByPlaceholderText('common.placeholder.input')).not.toBeInTheDocument()
      expect(screen.getByText('Test Credential')).toBeInTheDocument()
      await triggerRename(user)
      expect(
        screen.getByRole('textbox', { name: 'common.operation.rename Test Credential' }),
      ).toHaveValue('Test Credential')
    })
  })

  describe('Event Bubbling', () => {
    it('should stop event propagation when interacting with rename mode elements', async () => {
      const user = userEvent.setup()
      // Arrange
      const parentClick = vi.fn()
      render(
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Test-only ancestor observes click propagation without being a control.
        <div onClick={parentClick}>
          <Item credentialItem={mockCredentialItem} onAction={mockOnAction} canManageCredential />
        </div>,
      )
      // Act & Assert
      // We need to enter rename mode first
      await triggerRename(user)
      parentClick.mockClear()

      await user.click(screen.getByPlaceholderText('common.placeholder.input'))
      expect(parentClick).not.toHaveBeenCalled()

      await user.click(screen.getByText('common.operation.save'))
      expect(parentClick).not.toHaveBeenCalled()

      // Re-enter rename mode for cancel test
      await triggerRename(user)
      parentClick.mockClear()

      await user.click(screen.getByText('common.operation.cancel'))
      expect(parentClick).not.toHaveBeenCalled()
    })
  })
})
