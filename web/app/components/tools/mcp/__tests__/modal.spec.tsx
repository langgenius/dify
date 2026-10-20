import type { SsoProtocol } from '@dify/contracts/api/console/system-features/types.gen'
import type { ComponentProps } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { uploadRemoteFileInfo } from '@/service/common'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { mockEmojiData, renderWithEmoji } from '@/test/emoji-picker'
import { createMcpProviderFixture as createProvider } from '@/test/fixtures/mcp'
import MCPModal from '../modal'

vi.mock('@/service/common', () => ({ uploadRemoteFileInfo: vi.fn() }))

const uploadedIcon = {
  id: 'favicon-id',
  name: 'icon.png',
  size: 100,
  mime_type: 'image/png',
  url: 'https://example.com/icon.png',
} satisfies Awaited<ReturnType<typeof uploadRemoteFileInfo>>

const setup = (
  props: Partial<ComponentProps<typeof MCPModal>> = {},
  sso?: { enabled: boolean; protocol: SsoProtocol | null },
) => {
  const onConfirm = vi.fn()
  const onHide = vi.fn()
  const { wrapper: ConsoleWrapper } = createConsoleQueryWrapper({
    systemFeatures: {
      sso_enforced_for_signin: sso?.enabled ?? false,
      sso_enforced_for_signin_protocol: sso?.protocol ?? null,
    },
  })
  const modalProps = { show: true, onConfirm, onHide, ...props }
  const view = renderWithEmoji(<MCPModal {...modalProps} />, {
    wrapper: ({ children }) => (
      <ConsoleWrapper>
        {children}
        <AppToastHost timeout={0} />
      </ConsoleWrapper>
    ),
  })
  return { ...view, onConfirm, onHide, modalProps, user: userEvent.setup() }
}

const replaceField = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  value: string,
) => {
  const field = screen.getByRole('textbox', { name: `tools.mcp.modal.${name}` })
  await user.clear(field)
  await user.click(field)
  await user.paste(value)
}
const fillRequiredFields = async (
  user: ReturnType<typeof userEvent.setup>,
  url = 'https://api.example.co.uk/mcp',
  identifier = 'test-server',
) => {
  await replaceField(user, 'serverUrl', url)
  await replaceField(user, 'name', 'Test Server')
  await replaceField(user, 'serverIdentifier', identifier)
}
const submitButton = (edit = false) =>
  screen.getByRole('button', { name: `tools.mcp.modal.${edit ? 'save' : 'confirm'}` })

beforeEach(() => {
  vi.mocked(uploadRemoteFileInfo).mockReset().mockResolvedValue(uploadedIcon)
})
afterEach(() => toast.dismiss())
mockEmojiData()

describe('MCP server configuration', () => {
  it('submits a new server with defaults and the uploaded icon id, then closes', async () => {
    const { user, onConfirm, onHide } = setup()
    expect(submitButton()).toBeDisabled()
    await fillRequiredFields(user)
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    expect(uploadRemoteFileInfo).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=example.co.uk&sz=128',
      undefined,
      true,
    )
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Test Server',
      server_url: 'https://api.example.co.uk/mcp',
      server_identifier: 'test-server',
      icon_type: 'image',
      icon: 'favicon-id',
      icon_background: undefined,
      headers: undefined,
      authentication: { client_id: '', client_secret: '' },
      configuration: { timeout: 30, sse_read_timeout: 300 },
      is_dynamic_registration: true,
      identity_mode: 'off',
    })
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('cancels without submitting the draft', async () => {
    const { user, onHide, onConfirm } = setup()
    await replaceField(user, 'name', 'Unsaved server')
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.cancel' }))
    expect(onHide).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each([
    ['not-a-valid-url', 'test-server', 'invalidServerUrl'],
    ['https://example.com/mcp', 'Invalid Server ID!', 'invalidServerIdentifier'],
  ])('rejects invalid configuration (%s, %s)', async (url, identifier, error) => {
    const { user, onConfirm } = setup()
    await fillRequiredFields(user, url, identifier)
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())
    expect(await screen.findByText(`tools.mcp.modal.${error}`)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    if (error === 'invalidServerUrl') expect(uploadRemoteFileInfo).not.toHaveBeenCalled()
  })

  it('preserves stored credentials, headers and timeouts without re-fetching the icon', async () => {
    const { user, onConfirm, onHide } = setup({
      data: createProvider({
        configuration: { timeout: 60, sse_read_timeout: 600 },
        masked_headers: { Authorization: '***', 'X-Custom': 'value' },
        is_dynamic_registration: false,
        authentication: { client_id: 'client-123', client_secret: 'secret-456' },
      }),
    })
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientID' })).toHaveValue(
      'client-123',
    )
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientSecret' })).toHaveValue(
      'secret-456',
    )
    // Blur the existing URL through the same UI that would upload an icon in create mode.
    await user.click(screen.getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' }))
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        server_url: '[__HIDDEN__]',
        icon_type: 'emoji',
        icon: '🚀',
        icon_background: '#FF0000',
        configuration: { timeout: 60, sse_read_timeout: 600 },
        headers: { Authorization: '***', 'X-Custom': 'value' },
        authentication: { client_id: 'client-123', client_secret: 'secret-456' },
        is_dynamic_registration: false,
      }),
    )
    expect(uploadRemoteFileInfo).not.toHaveBeenCalled()
    expect(onHide).not.toHaveBeenCalled()
  })

  it('uses defaults when editing a provider without optional configuration', async () => {
    const { user, onConfirm } = setup({ data: createProvider() })
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: { timeout: 30, sse_read_timeout: 300 },
        headers: undefined,
        authentication: { client_id: '', client_secret: '' },
        is_dynamic_registration: true,
      }),
    )
  })

  it('warns about changed connection details and submits their new values', async () => {
    const { user, onConfirm } = setup({ data: createProvider() })
    await replaceField(user, 'serverUrl', 'https://new.com/mcp')
    await replaceField(user, 'serverIdentifier', 'new-server')
    expect(screen.getByText('tools.mcp.modal.serverUrlWarning')).toBeInTheDocument()
    expect(screen.getByText('tools.mcp.modal.serverIdentifierWarning')).toBeInTheDocument()
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        server_url: 'https://new.com/mcp',
        server_identifier: 'new-server',
      }),
    )
  })

  it('loads the selected provider instead of retaining a create draft', async () => {
    const { user, rerender, modalProps, onConfirm } = setup()
    await replaceField(user, 'name', 'Unsaved server')
    rerender(<MCPModal {...modalProps} data={createProvider()} />)
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.name' })).toHaveValue(
      'Existing Server',
    )
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Existing Server' }))
  })

  it('submits edited timeout settings', async () => {
    const { user, onConfirm } = setup({ data: createProvider() })
    await user.click(screen.getByRole('radio', { name: 'tools.mcp.modal.configurations' }))
    await replaceField(user, 'timeout', '45')
    await replaceField(user, 'sseReadTimeout', '450')
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: { timeout: 45, sse_read_timeout: 450 },
      }),
    )
  })

  it.each([
    ['https://example.com/files/uploaded-id/file-preview/icon.png', 'image', 'uploaded-id'],
    ['https://example.com/icon.png', 'emoji', '🔗'],
  ])('submits the persisted icon or its fallback for %s', async (url, type, icon) => {
    const { user, onConfirm } = setup({ data: createProvider({ icon: url }) })
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ icon_type: type, icon }))
  })

  it.each([true, false])(
    'applies an icon edit only after confirmation (confirm=%s)',
    async (confirm) => {
      const { user, onConfirm } = setup({ data: createProvider() })
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
      await user.click(submitButton(true))
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          icon_type: 'emoji',
          icon: '🚀',
          icon_background: confirm ? '#F3FEE7' : '#FF0000',
        }),
      )
    },
  )

  it.each([
    createHttpError(new Response(null, { status: 400 }), {
      code: 'UPLOAD_ERROR',
      message: 'Remote icon upload failed',
    }),
    new TypeError('Failed to fetch'),
  ])('allows submission with the default icon after upload failure: $message', async (error) => {
    vi.mocked(uploadRemoteFileInfo).mockRejectedValueOnce(error)
    const { user, onConfirm } = setup()
    await fillRequiredFields(user)
    expect(await screen.findByText(error.message)).toBeInTheDocument()
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        icon_type: 'emoji',
        icon: '🔗',
        icon_background: '#6366F1',
      }),
    )
  })

  it('keeps the newest URL icon when an earlier upload finishes last', async () => {
    const first = createDeferred<Awaited<ReturnType<typeof uploadRemoteFileInfo>>>()
    vi.mocked(uploadRemoteFileInfo).mockReturnValueOnce(first.promise)
    const { user, onConfirm } = setup()
    await fillRequiredFields(user, 'https://first.example.com/mcp')
    await waitFor(() => expect(uploadRemoteFileInfo).toHaveBeenCalledOnce())
    expect(submitButton()).toBeDisabled()
    await replaceField(user, 'serverUrl', 'https://second.example.org/mcp')
    await user.tab()
    await waitFor(() => expect(submitButton()).toBeEnabled())
    expect(uploadRemoteFileInfo).toHaveBeenLastCalledWith(
      'https://www.google.com/s2/favicons?domain=example.org&sz=128',
      undefined,
      true,
    )
    await act(async () => {
      first.resolve({ ...uploadedIcon, id: 'stale-icon', url: 'https://example.com/stale.png' })
      await first.promise
    })
    await user.click(submitButton())
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        server_url: 'https://second.example.org/mcp',
        icon: 'favicon-id',
      }),
    )
  })
})

describe('MCP identity forwarding', () => {
  it.each<{ enabled: boolean; protocol: SsoProtocol | null; visible: boolean }>([
    { enabled: false, protocol: 'oidc', visible: false },
    { enabled: true, protocol: 'saml', visible: false },
    { enabled: true, protocol: 'oidc', visible: true },
    { enabled: true, protocol: 'oauth2', visible: true },
  ])('requires refresh-capable SSO ($enabled, $protocol)', ({ enabled, protocol, visible }) => {
    setup({}, { enabled, protocol })
    const toggle = screen.queryByRole('switch', { name: 'tools.mcp.modal.forwardUserIdentity' })
    if (visible) {
      expect(toggle).not.toBeChecked()
      expect(screen.getByText('tools.mcp.modal.forwardUserIdentityTip')).toBeInTheDocument()
    } else expect(toggle).not.toBeInTheDocument()
  })

  it('submits identity forwarding when enabled by the user', async () => {
    const { user, onConfirm } = setup({}, { enabled: true, protocol: 'oidc' })
    await fillRequiredFields(user)
    await user.click(screen.getByRole('switch', { name: 'tools.mcp.modal.forwardUserIdentity' }))
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ identity_mode: 'idp_token' }))
  })

  it.each(['off', 'idp_token'] as const)('preserves saved identity mode %s', async (mode) => {
    const { user, onConfirm } = setup(
      { data: createProvider({ identity_mode: mode }) },
      { enabled: true, protocol: 'oidc' },
    )
    const toggle = screen.getByRole('switch', { name: 'tools.mcp.modal.forwardUserIdentity' })
    if (mode === 'idp_token') expect(toggle).toBeChecked()
    else expect(toggle).not.toBeChecked()
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ identity_mode: mode }))
  })

  it('disables saved identity forwarding when SSO is unavailable', async () => {
    const { user, onConfirm } = setup({ data: createProvider({ identity_mode: 'idp_token' }) })
    await user.click(submitButton(true))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ identity_mode: 'off' }))
  })
})
