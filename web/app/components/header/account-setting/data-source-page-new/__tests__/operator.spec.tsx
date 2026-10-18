import type { DatasourceCredentialResponse } from '@dify/contracts/api/console/auth/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import Operator from '../operator'

describe('Operator Component', () => {
  const mockOnAction = vi.fn()
  const mockOnRename = vi.fn()

  const createMockCredential = (type: CredentialTypeEnum): DatasourceCredentialResponse => ({
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

  it('identifies the credential in each action button name', () => {
    render(
      <>
        <Operator
          credentialItem={createMockCredential(CredentialTypeEnum.API_KEY)}
          onAction={mockOnAction}
        />
        <Operator
          credentialItem={{
            ...createMockCredential(CredentialTypeEnum.OAUTH2),
            name: 'Work Account',
          }}
          onAction={mockOnAction}
        />
      </>,
    )

    expect(
      screen.getByRole('button', { name: 'common.operation.more Test Credential' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.operation.more Work Account' }),
    ).toBeInTheDocument()
  })

  describe('Conditional Action Rendering', () => {
    it('should render correct actions for API_KEY type', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)

      render(
        <Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />,
      )
      await user.click(screen.getByRole('button'))

      expect(await screen.findByText('plugin.auth.setDefault')).toBeInTheDocument()
      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.rename')).not.toBeInTheDocument()
      expect(
        screen.queryByText('common.dataSource.notion.changeAuthorizedPages'),
      ).not.toBeInTheDocument()
    })

    it('should render correct actions for OAUTH2 type', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)

      render(
        <Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />,
      )
      await user.click(screen.getByRole('button'))

      expect(await screen.findByText('plugin.auth.setDefault')).toBeInTheDocument()
      expect(screen.getByText('common.operation.rename')).toBeInTheDocument()
      expect(screen.getByText('common.dataSource.notion.changeAuthorizedPages')).toBeInTheDocument()
      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.edit')).not.toBeInTheDocument()
    })
  })

  describe('Action Callbacks', () => {
    it('should call onRename when "rename" action is selected', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
      render(
        <Operator
          credentialItem={credential}
          onAction={mockOnAction}
          onRename={mockOnRename}
          canManageCredential
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(await screen.findByText('common.operation.rename'))

      await waitFor(() => {
        expect(mockOnRename).toHaveBeenCalledTimes(1)
      })
      expect(mockOnAction).not.toHaveBeenCalled()
    })

    it('should call onAction for "setDefault" action', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(
        <Operator
          credentialItem={credential}
          onAction={mockOnAction}
          onRename={mockOnRename}
          canUseCredential
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(await screen.findByText('plugin.auth.setDefault'))

      await waitFor(() => {
        expect(mockOnAction).toHaveBeenCalledWith('setDefault', credential)
      })
    })

    it('should call onAction for "edit" action', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(
        <Operator
          credentialItem={credential}
          onAction={mockOnAction}
          onRename={mockOnRename}
          canManageCredential
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(await screen.findByText('common.operation.edit'))

      await waitFor(() => {
        expect(mockOnAction).toHaveBeenCalledWith('edit', credential)
      })
    })

    it('should call onAction for "change" action', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.OAUTH2)
      render(
        <Operator
          credentialItem={credential}
          onAction={mockOnAction}
          onRename={mockOnRename}
          canManageCredential
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(await screen.findByText('common.dataSource.notion.changeAuthorizedPages'))

      await waitFor(() => {
        expect(mockOnAction).toHaveBeenCalledWith('change', credential)
      })
    })

    it('should call onAction for "delete" action', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(
        <Operator
          credentialItem={credential}
          onAction={mockOnAction}
          onRename={mockOnRename}
          canManageCredential
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(await screen.findByText('common.operation.remove'))

      await waitFor(() => {
        expect(mockOnAction).toHaveBeenCalledWith('delete', credential)
      })
    })

    it('should not call actions by default when credential permissions are omitted', async () => {
      const user = userEvent.setup()
      const credential = createMockCredential(CredentialTypeEnum.API_KEY)
      render(
        <Operator credentialItem={credential} onAction={mockOnAction} onRename={mockOnRename} />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(await screen.findByText('plugin.auth.setDefault'))
      await user.click(screen.getByText('common.operation.edit'))
      await user.click(screen.getByText('common.operation.remove'))

      await waitFor(() => {
        expect(mockOnAction).not.toHaveBeenCalled()
        expect(mockOnRename).not.toHaveBeenCalled()
      })
    })
  })
})
