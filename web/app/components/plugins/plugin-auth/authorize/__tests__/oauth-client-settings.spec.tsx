import type { Ref } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockToastSuccess = vi.fn()
const mockSetPluginOAuthCustomClient = vi.fn().mockResolvedValue({})
const mockDeletePluginOAuthCustomClient = vi.fn().mockResolvedValue({})
const mockInvalidPluginOAuthClientSchema = vi.fn()
const mockFormValues = { isCheckValidated: true, values: { __oauth_client__: 'custom', client_id: 'test-id' } }

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
  },
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

vi.mock('@/app/components/base/form/form-scenarios/auth', () => {
  const MockAuthForm = ({ ref }: Record<string, unknown> & { ref?: Ref<unknown> }) => {
    useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return <div data-testid="auth-form" />
  }

  return {
    default: MockAuthForm,
  }
})

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
    const mockOnOpenChange = vi.fn()
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        onClose={mockOnClose}
        onOpenChange={mockOnOpenChange}
      />,
    )

    fireEvent.click(screen.getByText('common.operation.cancel'))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
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

    fireEvent.click(screen.getByText('plugin.auth.saveOnly'))

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

    fireEvent.click(screen.getByText('plugin.auth.saveAndAuth'))

    await waitFor(() => {
      expect(mockSetPluginOAuthCustomClient).toHaveBeenCalled()
    })
    expect(mockOnAuth).toHaveBeenCalled()
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
