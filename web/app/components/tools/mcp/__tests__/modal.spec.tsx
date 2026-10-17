import type { SsoProtocol } from '@dify/contracts/api/console/system-features/types.gen'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { zSsoProtocol } from '@dify/contracts/api/console/system-features/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
import MCPModal from '../modal'

// Mock the service API
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn().mockResolvedValue({
    id: 'favicon-id',
    name: 'icon.png',
    size: 100,
    mime_type: 'image/png',
    url: 'https://example.com/icon.png',
  }),
}))

const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({
  toast: {
    error: mockToastError,
  },
}))

// Default: SSO off entirely. Tests that need the toggle visible flip
// `sso_enforced_for_signin = true` AND set the protocol to 'oidc' or
// 'oauth2'. Tests for the SAML gate set protocol = 'saml' to assert the
// toggle stays hidden even when sso_enforced_for_signin is true.
const mockSystemFeatures = vi.hoisted(() => ({
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: null as SsoProtocol | null,
}))
describe('MCPModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures.sso_enforced_for_signin = false
    mockSystemFeatures.sso_enforced_for_signin_protocol = null
  })

  const createWrapper = () =>
    createConsoleQueryWrapper({ systemFeatures: mockSystemFeatures }).wrapper

  const defaultProps = {
    show: true,
    onConfirm: vi.fn(),
    onHide: vi.fn(),
  }

  describe('Rendering', () => {
    it('should not render when show is false', () => {
      render(<MCPModal {...defaultProps} show={false} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.modal.title')).not.toBeInTheDocument()
    })
  })

  describe('Action Buttons', () => {
    it('should call onHide when cancel is clicked', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      render(<MCPModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const cancelButton = screen.getByText('tools.mcp.modal.cancel')
      await user.click(cancelButton)

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when close icon is clicked', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      render(<MCPModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      await user.click(screen.getByRole('button', { name: /operation\.close/ }))
      expect(onHide).toHaveBeenCalled()
    })

    it('should call onHide when the dialog requests close', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      render(<MCPModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      await user.keyboard('{Escape}')

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should have confirm button disabled when form is empty', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      expect(confirmButton)!.toBeDisabled()
    })
  })

  describe('Form Submission', () => {
    it('should call onConfirm with correct data when form is submitted', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText(
        'tools.mcp.modal.serverIdentifierPlaceholder',
      )

      await user.clear(urlInput)
      await user.click(urlInput)
      await user.paste('https://example.com/mcp')
      await user.clear(nameInput)
      await user.click(nameInput)
      await user.paste('Test Server')
      await user.clear(identifierInput)
      await user.click(identifierInput)
      await user.paste('test-server')

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      await user.click(confirmButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Test Server',
            server_url: 'https://example.com/mcp',
            server_identifier: 'test-server',
            authentication: { client_id: '', client_secret: '' },
            configuration: { timeout: 30, sse_read_timeout: 300 },
            is_dynamic_registration: true,
          }),
        )
      })
    })

    it('should not call onConfirm with invalid URL', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill fields with invalid URL
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText(
        'tools.mcp.modal.serverIdentifierPlaceholder',
      )

      await user.clear(urlInput)
      await user.click(urlInput)
      await user.paste('not-a-valid-url')
      await user.clear(nameInput)
      await user.click(nameInput)
      await user.paste('Test Server')
      await user.clear(identifierInput)
      await user.click(identifierInput)
      await user.paste('test-server')

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      await user.click(confirmButton)

      expect(onConfirm).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('tools.mcp.modal.invalidServerUrl')
    })

    it('should not call onConfirm with invalid server identifier', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill fields with invalid server identifier
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText(
        'tools.mcp.modal.serverIdentifierPlaceholder',
      )

      await user.clear(urlInput)
      await user.click(urlInput)
      await user.paste('https://example.com/mcp')
      await user.clear(nameInput)
      await user.click(nameInput)
      await user.paste('Test Server')
      await user.clear(identifierInput)
      await user.click(identifierInput)
      await user.paste('Invalid Server ID!')

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      await user.click(confirmButton)

      expect(onConfirm).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('tools.mcp.modal.invalidServerIdentifier')
    })
  })

  describe('Edit Mode', () => {
    const mockData = {
      id: 'test-id',
      name: 'Existing Server',
      server_url: 'https://existing.com/mcp',
      server_identifier: 'existing-server',
      icon: { content: '🚀', background: '#FF0000' },
      configuration: {
        timeout: 60,
        sse_read_timeout: 600,
      },
      masked_headers: {
        Authorization: '***',
      },
      is_dynamic_registration: false,
      authentication: {
        client_id: 'client-123',
        client_secret: 'secret-456',
      },
    } as unknown as ToolWithProvider

    it('should show warning when URL is changed', async () => {
      const user = userEvent.setup()
      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      const urlInput = screen.getByDisplayValue('https://existing.com/mcp')
      await user.clear(urlInput)
      await user.click(urlInput)
      await user.paste('https://new.com/mcp')

      expect(screen.getByText('tools.mcp.modal.serverUrlWarning'))!.toBeInTheDocument()
    })

    it('should show warning when server identifier is changed', async () => {
      const user = userEvent.setup()
      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      const identifierInput = screen.getByDisplayValue('existing-server')
      await user.clear(identifierInput)
      await user.click(identifierInput)
      await user.paste('new-server')

      expect(screen.getByText('tools.mcp.modal.serverIdentifierWarning'))!.toBeInTheDocument()
    })
  })

  describe('Form Key Reset', () => {
    it('should reset form when switching from create to edit mode', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Fill some data in create mode
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      await user.clear(nameInput)
      await user.click(nameInput)
      await user.paste('New Server')

      // Switch to edit mode with different data
      const mockData = {
        id: 'edit-id',
        name: 'Edit Server',
        icon: { content: '🔗', background: '#6366F1' },
      } as unknown as ToolWithProvider

      rerender(<MCPModal {...defaultProps} data={mockData} />)

      // Should show edit mode data
      // Should show edit mode data
      expect(screen.getByDisplayValue('Edit Server'))!.toBeInTheDocument()
    })
  })

  describe('Form Submission with Headers', () => {
    it('should format headers correctly when submitting with header keys', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const mockData = {
        id: 'test-id',
        name: 'Test Server',
        server_url: 'https://example.com/mcp',
        server_identifier: 'test-server',
        icon: { content: '🔗', background: '#6366F1' },
        masked_headers: {
          Authorization: 'Bearer token',
          'X-Custom': 'value',
        },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, {
        wrapper: createWrapper(),
      })

      // Switch to headers tab
      const headersTab = screen.getByText('tools.mcp.modal.headers')
      await user.click(headersTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.headersTip'))!.toBeInTheDocument()
      })

      // Submit form
      const saveButton = screen.getByText('tools.mcp.modal.save')
      await user.click(saveButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: { Authorization: 'Bearer token', 'X-Custom': 'value' },
          }),
        )
      })
    })
  })

  describe('Edit Mode Submission', () => {
    it('should send hidden URL when URL is unchanged in edit mode', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const mockData = {
        id: 'test-id',
        name: 'Existing Server',
        server_url: 'https://existing.com/mcp',
        server_identifier: 'existing-server',
        icon: { content: '🚀', background: '#FF0000' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, {
        wrapper: createWrapper(),
      })

      // Don't change the URL, just submit
      const saveButton = screen.getByText('tools.mcp.modal.save')
      await user.click(saveButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            server_url: '[__HIDDEN__]',
          }),
        )
      })
    })

    it('should send new URL when URL is changed in edit mode', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const mockData = {
        id: 'test-id',
        name: 'Existing Server',
        server_url: 'https://existing.com/mcp',
        server_identifier: 'existing-server',
        icon: { content: '🚀', background: '#FF0000' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, {
        wrapper: createWrapper(),
      })

      // Change the URL
      const urlInput = screen.getByDisplayValue('https://existing.com/mcp')
      await user.clear(urlInput)
      await user.click(urlInput)
      await user.paste('https://new.com/mcp')

      const saveButton = screen.getByText('tools.mcp.modal.save')
      await user.click(saveButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            server_url: 'https://new.com/mcp',
          }),
        )
      })
    })
  })

  describe('Configuration Section', () => {
    it('should submit with custom timeout values', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText(
        'tools.mcp.modal.serverIdentifierPlaceholder',
      )

      await user.clear(urlInput)
      await user.click(urlInput)
      await user.paste('https://example.com/mcp')
      await user.clear(nameInput)
      await user.click(nameInput)
      await user.paste('Test Server')
      await user.clear(identifierInput)
      await user.click(identifierInput)
      await user.paste('test-server')

      // Switch to configurations tab
      const configTab = screen.getByText('tools.mcp.modal.configurations')
      await user.click(configTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.timeout'))!.toBeInTheDocument()
      })

      const timeout = screen.getByRole('textbox', { name: 'tools.mcp.modal.timeout' })
      const sseTimeout = screen.getByRole('textbox', { name: 'tools.mcp.modal.sseReadTimeout' })
      await user.clear(timeout)
      await user.click(timeout)
      await user.paste('45')
      await user.clear(sseTimeout)
      await user.click(sseTimeout)
      await user.paste('450')
      const confirmButton = screen.getByRole('button', { name: 'tools.mcp.modal.confirm' })
      await user.click(confirmButton)
      await waitFor(() =>
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({ configuration: { timeout: 45, sse_read_timeout: 450 } }),
        ),
      )
    })
  })

  it.each([true, false])(
    'applies an icon edit only after confirmation (confirm=%s)',
    async (confirm) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      const data = {
        id: 'edit-server',
        name: 'Server',
        server_url: 'https://example.com/mcp',
        server_identifier: 'server',
        icon: { content: '🚀', background: '#FF0000' },
      } as ToolWithProvider
      render(<MCPModal {...defaultProps} data={data} onConfirm={onConfirm} />, {
        wrapper: createWrapper(),
      })
      await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.changeIcon' }))
      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      if (confirm) await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
      else await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'app.iconPicker.title' }),
        ).not.toBeInTheDocument(),
      )
      expect(onConfirm).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))
      await waitFor(() =>
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_type: 'emoji',
            icon: '🚀',
            icon_background: confirm ? '#F3FEE7' : '#FF0000',
          }),
        ),
      )
    },
  )

  // M3 — Forward-user-identity toggle (PR #36840).
  describe('Forward-user-identity toggle', () => {
    beforeEach(() => {
      mockSystemFeatures.sso_enforced_for_signin = false
      mockSystemFeatures.sso_enforced_for_signin_protocol = null
    })

    // Helper: turn SSO on with a refresh-capable protocol so the toggle is
    // visible. Use this for any test that needs the field rendered.
    const enableRefreshCapableSSO = () => {
      mockSystemFeatures.sso_enforced_for_signin = true
      mockSystemFeatures.sso_enforced_for_signin_protocol = zSsoProtocol.enum.oidc
    }

    const fillRequiredFields = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(
        screen.getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' }),
        'https://example.com/mcp',
      )
      await user.type(screen.getByRole('textbox', { name: 'tools.mcp.modal.name' }), 'srv')
      await user.type(
        screen.getByRole('textbox', { name: 'tools.mcp.modal.serverIdentifier' }),
        'srv-id',
      )
    }

    it('does not render the toggle when SSO is not configured', () => {
      mockSystemFeatures.sso_enforced_for_signin = false
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.modal.forwardUserIdentity')).not.toBeInTheDocument()
    })

    it('renders the toggle and helper tip when SSO is configured', () => {
      enableRefreshCapableSSO()
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.forwardUserIdentity')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.forwardUserIdentityTip')).toBeInTheDocument()
    })

    it('does not render the toggle when SSO protocol is SAML (no refresh model)', () => {
      mockSystemFeatures.sso_enforced_for_signin = true
      mockSystemFeatures.sso_enforced_for_signin_protocol = zSsoProtocol.enum.saml
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.modal.forwardUserIdentity')).not.toBeInTheDocument()
    })

    it('renders the toggle when SSO protocol is OAuth2', () => {
      mockSystemFeatures.sso_enforced_for_signin = true
      mockSystemFeatures.sso_enforced_for_signin_protocol = zSsoProtocol.enum.oauth2
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.forwardUserIdentity')).toBeInTheDocument()
    })

    it('submits identity_mode="off" by default (toggle off)', async () => {
      const user = userEvent.setup()
      enableRefreshCapableSSO()
      const onConfirm = vi.fn()
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      await fillRequiredFields(user)
      await user.click(screen.getByText('tools.mcp.modal.confirm'))

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            identity_mode: 'off',
          }),
        )
      })
    })

    it('submits identity_mode="idp_token" when toggle is flipped on', async () => {
      const user = userEvent.setup()
      enableRefreshCapableSSO()
      const onConfirm = vi.fn()
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      await fillRequiredFields(user)
      const fwdSwitch = screen.getByRole('switch', {
        name: 'tools.mcp.modal.forwardUserIdentity',
      })
      await user.click(fwdSwitch)
      await user.click(screen.getByText('tools.mcp.modal.confirm'))

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            identity_mode: 'idp_token',
          }),
        )
      })
    })

    it('clamps to identity_mode="off" when SSO is unavailable, even if existing data had it on', async () => {
      const user = userEvent.setup()
      mockSystemFeatures.sso_enforced_for_signin = false
      const onConfirm = vi.fn()
      const mockData = {
        id: 'existing-1',
        name: 'srv',
        server_url: 'https://example.com/mcp',
        server_identifier: 'srv-id',
        icon: { content: '🔗', background: '#6366F1' },
        identity_mode: 'idp_token',
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, {
        wrapper: createWrapper(),
      })
      await user.click(screen.getByText('tools.mcp.modal.save'))

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            identity_mode: 'off',
          }),
        )
      })
    })

    // Regression: editing a provider saved with identity_mode="idp_token" must
    // hydrate the toggle ON (issue: it showed off despite the persisted value).
    it('hydrates the toggle ON when editing a provider with identity_mode="idp_token"', () => {
      enableRefreshCapableSSO()
      const mockData = {
        id: 'existing-idp',
        name: 'srv',
        server_url: 'https://example.com/mcp',
        server_identifier: 'srv-id',
        icon: { content: '🔗', background: '#6366F1' },
        identity_mode: 'idp_token',
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      expect(
        screen.getByRole('switch', { name: 'tools.mcp.modal.forwardUserIdentity' }),
      ).toBeChecked()
    })

    it('hydrates the toggle OFF when editing a provider with identity_mode="off"', () => {
      enableRefreshCapableSSO()
      const mockData = {
        id: 'existing-off',
        name: 'srv',
        server_url: 'https://example.com/mcp',
        server_identifier: 'srv-id',
        icon: { content: '🔗', background: '#6366F1' },
        identity_mode: 'off',
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      expect(
        screen.getByRole('switch', { name: 'tools.mcp.modal.forwardUserIdentity' }),
      ).not.toBeChecked()
    })
  })
})

mockEmojiData()
