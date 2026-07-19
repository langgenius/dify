import type { ComponentProps, ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MCPModal from '../modal'

const mockUploadRemoteFileInfo = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
const mockSystemFeatures = vi.hoisted(() => ({
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '' as 'oidc' | 'oauth2' | 'saml' | '',
}))

vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: mockUploadRemoteFileInfo,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mockToastError,
    warning: vi.fn(),
  },
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['mock-system-features'],
    queryFn: async () => mockSystemFeatures,
  }),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  queryClient.setQueryData(['mock-system-features'], mockSystemFeatures)

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const createEditData = (overrides: Partial<ToolWithProvider> = {}) =>
  ({
    id: 'server-1',
    name: 'Existing server',
    server_url: 'https://existing.example.com/mcp',
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
      client_id: 'existing-client',
      client_secret: 'existing-secret',
    },
    ...overrides,
  }) as unknown as ToolWithProvider

const renderModal = (props: Partial<ComponentProps<typeof MCPModal>> = {}) => {
  const onConfirm = vi.fn()
  const onHide = vi.fn()
  const user = userEvent.setup()

  const result = render(<MCPModal show onConfirm={onConfirm} onHide={onHide} {...props} />, {
    wrapper: createWrapper(),
  })

  return { ...result, onConfirm, onHide, user }
}

const fillRequiredFields = async (
  user: ReturnType<typeof userEvent.setup>,
  values = {
    url: 'https://example.com/mcp',
    name: 'Test server',
    identifier: 'test-server',
  },
) => {
  await user.type(screen.getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' }), values.url)
  await user.type(screen.getByRole('textbox', { name: 'tools.mcp.modal.name' }), values.name)
  await user.type(
    screen.getByRole('textbox', { name: 'tools.mcp.modal.serverIdentifier' }),
    values.identifier,
  )
}

describe('MCPModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures.sso_enforced_for_signin = false
    mockSystemFeatures.sso_enforced_for_signin_protocol = ''
    mockUploadRemoteFileInfo.mockResolvedValue({
      url: 'https://example.com/files/file-123/file-preview/icon.png',
    })
  })

  it('does not render a dialog while closed', () => {
    render(<MCPModal show={false} onConfirm={vi.fn()} onHide={vi.fn()} />, {
      wrapper: createWrapper(),
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes the create dialog and required fields through accessible names', async () => {
    const { onHide, user } = renderModal()
    const dialog = screen.getByRole('dialog', { name: 'tools.mcp.modal.title' })

    expect(
      within(dialog).getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('textbox', { name: 'tools.mcp.modal.name' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('textbox', { name: 'tools.mcp.modal.serverIdentifier' }),
    ).toHaveAccessibleDescription('tools.mcp.modal.serverIdentifierTip')
    expect(within(dialog).getByRole('button', { name: 'tools.mcp.modal.confirm' })).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

    expect(onHide).toHaveBeenCalledOnce()
  })

  it.each([
    {
      values: { url: 'not-a-url', name: 'Test server', identifier: 'test-server' },
      message: 'tools.mcp.modal.invalidServerUrl',
    },
    {
      values: {
        url: 'https://example.com/mcp',
        name: 'Test server',
        identifier: 'Invalid Server ID',
      },
      message: 'tools.mcp.modal.invalidServerIdentifier',
    },
  ])('rejects invalid create data with $message', async ({ values, message }) => {
    const { onConfirm, user } = renderModal()
    await fillRequiredFields(user, values)
    const submitButton = screen.getByRole('button', { name: 'tools.mcp.modal.confirm' })
    await waitFor(() => expect(submitButton).toBeEnabled())

    await user.click(submitButton)

    expect(onConfirm).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith(message)
  })

  it('submits the create payload assembled from the real form sections', async () => {
    const { onConfirm, onHide, user } = renderModal()
    await fillRequiredFields(user)

    await user.click(
      screen.getByRole('switch', { name: 'tools.mcp.modal.useDynamicClientRegistration' }),
    )
    await user.type(screen.getByRole('textbox', { name: 'tools.mcp.modal.clientID' }), 'client-123')
    await user.type(
      screen.getByRole('textbox', { name: 'tools.mcp.modal.clientSecret' }),
      'secret-456',
    )

    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.headers' }))
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.addHeader' }))
    await user.type(
      screen.getByRole('textbox', { name: 'tools.mcp.modal.headerKey 1' }),
      'Authorization',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'tools.mcp.modal.headerValue 1' }),
      'Bearer token',
    )

    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.configurations' }))
    const timeout = screen.getByRole('textbox', { name: 'tools.mcp.modal.timeout' })
    const sseReadTimeout = screen.getByRole('textbox', {
      name: 'tools.mcp.modal.sseReadTimeout',
    })
    await user.clear(timeout)
    await user.type(timeout, '45')
    await user.clear(sseReadTimeout)
    await user.type(sseReadTimeout, '450')

    const submitButton = screen.getByRole('button', { name: 'tools.mcp.modal.confirm' })
    await waitFor(() => expect(submitButton).toBeEnabled())
    await user.click(submitButton)

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        server_url: 'https://example.com/mcp',
        name: 'Test server',
        icon_type: 'image',
        icon: 'file-123',
        icon_background: undefined,
        server_identifier: 'test-server',
        headers: { Authorization: 'Bearer token' },
        is_dynamic_registration: false,
        authentication: {
          client_id: 'client-123',
          client_secret: 'secret-456',
        },
        configuration: {
          timeout: 45,
          sse_read_timeout: 450,
        },
        identity_mode: 'off',
      })
    })
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('hydrates edit data and hides an unchanged server URL in the payload', async () => {
    const data = createEditData()
    const { onConfirm, onHide, user } = renderModal({ data })
    const dialog = screen.getByRole('dialog', { name: 'tools.mcp.modal.editTitle' })

    expect(within(dialog).getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' })).toHaveValue(
      'https://existing.example.com/mcp',
    )
    expect(within(dialog).getByRole('textbox', { name: 'tools.mcp.modal.name' })).toHaveValue(
      'Existing server',
    )
    expect(
      within(dialog).getByRole('textbox', { name: 'tools.mcp.modal.serverIdentifier' }),
    ).toHaveValue('existing-server')

    await user.click(within(dialog).getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          server_url: '[__HIDDEN__]',
          name: 'Existing server',
          server_identifier: 'existing-server',
          configuration: { timeout: 60, sse_read_timeout: 600 },
          identity_mode: 'off',
        }),
      )
    })
    expect(onHide).not.toHaveBeenCalled()
  })

  it('omits persisted manual credentials after switching back to dynamic registration', async () => {
    const { onConfirm, user } = renderModal({ data: createEditData() })
    const dynamicRegistration = screen.getByRole('switch', {
      name: 'tools.mcp.modal.useDynamicClientRegistration',
    })

    expect(dynamicRegistration).not.toBeChecked()
    await user.click(dynamicRegistration)
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    const payload = onConfirm.mock.calls[0]?.[0]
    expect(payload).toMatchObject({ is_dynamic_registration: true })
    expect(payload).not.toHaveProperty('authentication')
  })

  it('preserves zero timeout values through edit hydration and submission', async () => {
    const { onConfirm, user } = renderModal({
      data: createEditData({
        configuration: {
          timeout: 0,
          sse_read_timeout: 0,
        },
      }),
    })

    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.configurations' }))
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.timeout' })).toHaveValue('0')
    expect(screen.getByRole('textbox', { name: 'tools.mcp.modal.sseReadTimeout' })).toHaveValue('0')

    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ configuration: { timeout: 0, sse_read_timeout: 0 } }),
      )
    })
  })

  it.each([
    {
      caseName: 'preserves',
      nextValue: undefined,
      remove: false,
      expected: { Authorization: '***' },
    },
    {
      caseName: 'updates',
      nextValue: 'Bearer updated',
      remove: false,
      expected: { Authorization: 'Bearer updated' },
    },
    { caseName: 'removes', nextValue: undefined, remove: true, expected: undefined },
  ])('$caseName masked headers in the edit payload', async ({ nextValue, remove, expected }) => {
    const { onConfirm, user } = renderModal({ data: createEditData() })

    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.headers' }))
    expect(screen.getByText('tools.mcp.modal.maskedHeadersTip')).toBeInTheDocument()

    if (remove) {
      await user.click(
        screen.getByRole('button', { name: 'common.operation.delete Authorization' }),
      )
    } else if (nextValue) {
      const valueInput = screen.getByRole('textbox', { name: 'tools.mcp.modal.headerValue 1' })
      await user.clear(valueInput)
      await user.type(valueInput, nextValue)
    }

    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ headers: expected }))
    })
  })

  it('submits only once while the current confirmation is pending', async () => {
    let resolveConfirmation: (() => void) | undefined
    const confirmation = new Promise<void>((resolve) => {
      resolveConfirmation = resolve
    })
    const onConfirm = vi.fn(() => confirmation)
    const { user } = renderModal({ onConfirm })
    await fillRequiredFields(user)
    const nameInput = screen.getByRole('textbox', { name: 'tools.mcp.modal.name' })
    const submitButton = screen.getByRole('button', { name: 'tools.mcp.modal.confirm' })
    await waitFor(() => expect(submitButton).toBeEnabled())

    await user.click(nameInput)
    await user.keyboard('{Enter}{Enter}')

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(submitButton).toBeDisabled()

    resolveConfirmation?.()
    await waitFor(() => expect(submitButton).toBeEnabled())
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('warns before submitting a changed edit-mode server URL', async () => {
    const { onConfirm, user } = renderModal({ data: createEditData() })
    const urlInput = screen.getByRole('textbox', { name: 'tools.mcp.modal.serverUrl' })

    await user.clear(urlInput)
    await user.type(urlInput, 'https://new.example.com/mcp')

    expect(screen.getByText('tools.mcp.modal.serverUrlWarning')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ server_url: 'https://new.example.com/mcp' }),
      )
    })
  })

  it('submits forwarded identity only when refresh-capable SSO is available', async () => {
    mockSystemFeatures.sso_enforced_for_signin = true
    mockSystemFeatures.sso_enforced_for_signin_protocol = 'oidc'
    const { onConfirm, user } = renderModal()
    await fillRequiredFields(user)
    const identitySwitch = screen.getByRole('switch', {
      name: 'tools.mcp.modal.forwardUserIdentity',
    })

    expect(identitySwitch).not.toBeChecked()
    await user.click(identitySwitch)
    const submitButton = screen.getByRole('button', { name: 'tools.mcp.modal.confirm' })
    await waitFor(() => expect(submitButton).toBeEnabled())
    await user.click(submitButton)

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ identity_mode: 'idp_token' }),
      )
    })
  })

  it('hides unsupported identity forwarding and clamps persisted state to off', async () => {
    mockSystemFeatures.sso_enforced_for_signin = true
    mockSystemFeatures.sso_enforced_for_signin_protocol = 'saml'
    const { onConfirm, user } = renderModal({
      data: createEditData({ identity_mode: 'idp_token' }),
    })

    expect(
      screen.queryByRole('switch', { name: 'tools.mcp.modal.forwardUserIdentity' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ identity_mode: 'off' }))
    })
  })
})
