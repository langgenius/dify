import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockNotify = vi.fn()
const mockSetPluginOAuthCustomClient = vi.fn().mockResolvedValue({})
const mockDeletePluginOAuthCustomClient = vi.fn().mockResolvedValue({})
const mockInvalidPluginOAuthClientSchema = vi.fn()
const mockFormValues = { isCheckValidated: true, values: { __oauth_client__: 'custom', client_id: 'test-id' } }

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('../../hooks/use-credential', () => ({
  useSetPluginOAuthCustomClientHook: () => ({
    mutateAsync: mockSetPluginOAuthCustomClient,
  }),
  useDeletePluginOAuthCustomClientHook: () => ({
    mutateAsync: mockDeletePluginOAuthCustomClient,
  }),
  useInvalidPluginOAuthClientSchemaHook: () => mockInvalidPluginOAuthClientSchema,
}))

vi.mock('../../../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div data-testid="readme-entrance" />,
}))

vi.mock('../../../readme-panel/store', () => ({
  ReadmeShowType: { modal: 'modal' },
}))

vi.mock('@/app/components/base/modal/modal', () => ({
  default: ({ children, title, onClose: _onClose, onConfirm, onCancel, onExtraButtonClick, footerSlot }: {
    children: React.ReactNode
    title: string
    onClose?: () => void
    onConfirm?: () => void
    onCancel?: () => void
    onExtraButtonClick?: () => void
    footerSlot?: React.ReactNode
    [key: string]: unknown
  }) => (
    <div data-testid="modal">
      <div data-testid="modal-title">{title}</div>
      {children}
      <button data-testid="modal-confirm" onClick={onConfirm}>Save And Auth</button>
      <button data-testid="modal-cancel" onClick={onCancel}>Save Only</button>
      <button data-testid="modal-close" onClick={onExtraButtonClick}>Cancel</button>
      {!!footerSlot && <div data-testid="footer-slot">{footerSlot}</div>}
    </div>
  ),
}))

vi.mock('@/app/components/base/form/form-scenarios/auth', () => ({
  default: React.forwardRef((_props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return <div data-testid="auth-form" />
  }),
}))

vi.mock('@tanstack/react-form', () => ({
  useForm: (config: Record<string, unknown>) => ({
    store: { subscribe: vi.fn(), getState: () => ({ values: config.defaultValues || {} }) },
  }),
  useStore: (_store: unknown, selector: (state: Record<string, unknown>) => unknown) => {
    return selector({ values: { __oauth_client__: 'custom' } })
  },
}))

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

const defaultSchemas = [
  { name: 'client_id', label: 'Client ID', type: 'text-input', required: true },
] as never

describe('OAuthClientSettings', () => {
  let OAuthClientSettings: (typeof import('../oauth-client-settings'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../oauth-client-settings')
    OAuthClientSettings = mod.default
  })

  it('should render modal with correct title', () => {
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
      />,
    )

    expect(screen.getByTestId('modal-title')).toHaveTextContent('plugin.auth.oauthClientSettings')
  })

  it('should render auth form', () => {
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
      />,
    )

    expect(screen.getByTestId('auth-form')).toBeInTheDocument()
  })

  it('should call onClose when cancel clicked', () => {
    const mockOnClose = vi.fn()
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        onClose={mockOnClose}
      />,
    )

    fireEvent.click(screen.getByTestId('modal-close'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should save settings on save only button click', async () => {
    const mockOnClose = vi.fn()
    const mockOnUpdate = vi.fn()
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />,
    )

    fireEvent.click(screen.getByTestId('modal-cancel'))

    await waitFor(() => {
      expect(mockSetPluginOAuthCustomClient).toHaveBeenCalledWith(expect.objectContaining({
        enable_oauth_custom_client: true,
      }))
    })
  })

  it('should save and authorize on confirm button click', async () => {
    const mockOnAuth = vi.fn().mockResolvedValue(undefined)
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        onAuth={mockOnAuth}
      />,
    )

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockSetPluginOAuthCustomClient).toHaveBeenCalled()
    })
  })

  it('should render readme entrance when detail is provided', () => {
    const payload = { ...basePayload, detail: { name: 'Test' } as never }
    render(
      <OAuthClientSettings
        pluginPayload={payload}
        schemas={defaultSchemas}
      />,
    )

    expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
  })
})
