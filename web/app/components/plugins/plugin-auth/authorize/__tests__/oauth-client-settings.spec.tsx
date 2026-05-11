import type { OAuthClientSettingsProps } from '../oauth-client-settings'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockNotify = vi.fn()
const mockToast = {
  success: (message: string, options?: Record<string, unknown>) => mockNotify({ type: 'success', message, ...options }),
  error: (message: string, options?: Record<string, unknown>) => mockNotify({ type: 'error', message, ...options }),
  warning: (message: string, options?: Record<string, unknown>) => mockNotify({ type: 'warning', message, ...options }),
  info: (message: string, options?: Record<string, unknown>) => mockNotify({ type: 'info', message, ...options }),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: mockToast,
}))
const mockSetPluginOAuthCustomClient = vi.fn().mockResolvedValue({})
const mockDeletePluginOAuthCustomClient = vi.fn().mockResolvedValue({})
const mockInvalidPluginOAuthClientSchema = vi.fn()
let mockFormValues = { isCheckValidated: true, values: { __oauth_client__: 'custom', client_id: 'test-id' } }
let mockAuthFormProps: Record<string, unknown> | undefined

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

vi.mock('@/app/components/base/form/form-scenarios/auth', () => {
  const MockAuthForm = ({ ref, ...props }: { ref?: React.Ref<unknown> } & Record<string, unknown>) => {
    mockAuthFormProps = props
    React.useImperativeHandle(ref, () => ({
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

const PopoverSettingsHarness = ({
  OAuthClientSettings,
  onClose,
  onPopoverClose,
}: {
  OAuthClientSettings: React.FC<OAuthClientSettingsProps>
  onClose: () => void
  onPopoverClose: () => void
}) => {
  const [open, setOpen] = React.useState(true)

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen)
          onPopoverClose()
      }}
    >
      <PopoverTrigger render={<button type="button">OAuth</button>} />
      <PopoverContent>
        <div data-testid="oauth-popover">
          <OAuthClientSettings
            open={open}
            onOpenChange={setOpen}
            pluginPayload={basePayload}
            schemas={defaultSchemas}
            onClose={onClose}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

const ControlledSettingsHarness = ({
  OAuthClientSettings,
  onClose,
}: {
  OAuthClientSettings: React.FC<OAuthClientSettingsProps>
  onClose: () => void
}) => {
  const [open, setOpen] = React.useState(true)

  return (
    <>
      <div data-testid="modal-open-state">{String(open)}</div>
      <OAuthClientSettings
        open={open}
        onOpenChange={setOpen}
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        onClose={onClose}
      />
    </>
  )
}

describe('OAuthClientSettings', () => {
  let OAuthClientSettings: React.FC<OAuthClientSettingsProps>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFormValues = { isCheckValidated: true, values: { __oauth_client__: 'custom', client_id: 'test-id' } }
    mockAuthFormProps = undefined
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

  it('should render backdrop when nested inside another dialog', () => {
    render(
      <Dialog open>
        <DialogContent backdropClassName="bg-transparent">
          <OAuthClientSettings
            pluginPayload={basePayload}
            schemas={defaultSchemas}
          />
        </DialogContent>
      </Dialog>,
    )

    expect(document.querySelector('.bg-background-overlay')).toBeInTheDocument()
  })

  it('should pass schema defaults to auth form', () => {
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={[
          { name: 'client_id', label: 'Client ID', type: 'text-input', required: true, default: 'default-client-id' },
        ] as never}
      />,
    )

    expect(mockAuthFormProps?.defaultValues).toMatchObject({
      client_id: 'default-client-id',
    })
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

    fireEvent.click(screen.getByRole('button', { name: /operation\.cancel/i }))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should close through controlled open state when cancel clicked', async () => {
    const mockOnClose = vi.fn()
    render(<ControlledSettingsHarness OAuthClientSettings={OAuthClientSettings} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /operation\.cancel/i }))

    await waitFor(() => {
      expect(screen.getByTestId('modal-open-state')).toHaveTextContent('false')
    })
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should stay open when backdrop is clicked', () => {
    const mockOnClose = vi.fn()
    render(<ControlledSettingsHarness OAuthClientSettings={OAuthClientSettings} onClose={mockOnClose} />)

    const backdrop = document.querySelector('.bg-background-overlay')
    expect(backdrop).toBeInTheDocument()

    fireEvent.click(backdrop!)

    expect(screen.getByTestId('modal-open-state')).toHaveTextContent('true')
    expect(mockOnClose).not.toHaveBeenCalled()
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

  it('should ignore duplicate save clicks while action is pending', async () => {
    const mockOnClose = vi.fn()
    let resolveSave: (value: object) => void = () => {}
    mockSetPluginOAuthCustomClient.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve
    }))

    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        onClose={mockOnClose}
      />,
    )

    fireEvent.click(screen.getByTestId('modal-cancel'))

    await waitFor(() => {
      expect(mockSetPluginOAuthCustomClient).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByTestId('modal-cancel'))

    expect(mockSetPluginOAuthCustomClient).toHaveBeenCalledTimes(1)

    resolveSave({})

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled()
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

  it('should remove custom client settings', async () => {
    const mockOnClose = vi.fn()
    const mockOnUpdate = vi.fn()
    render(
      <OAuthClientSettings
        pluginPayload={basePayload}
        schemas={defaultSchemas}
        editValues={{ client_id: 'test-id' }}
        hasOriginalClientParams
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />,
    )

    fireEvent.click(screen.getByTestId('modal-extra'))

    await waitFor(() => {
      expect(mockDeletePluginOAuthCustomClient).toHaveBeenCalled()
    })
    expect(mockOnClose).toHaveBeenCalled()
    expect(mockOnUpdate).toHaveBeenCalled()
    expect(mockInvalidPluginOAuthClientSchema).toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      message: 'common.api.actionSuccess',
      type: 'success',
    }))
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

  it('should stay open when clicking inside the modal from a popover', async () => {
    const user = userEvent.setup()
    const mockOnClose = vi.fn()
    const mockOnPopoverClose = vi.fn()

    render(
      <PopoverSettingsHarness
        OAuthClientSettings={OAuthClientSettings}
        onClose={mockOnClose}
        onPopoverClose={mockOnPopoverClose}
      />,
    )

    const form = await screen.findByTestId('auth-form')

    await user.click(form)

    expect(mockOnClose).not.toHaveBeenCalled()
    expect(mockOnPopoverClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('modal')).toBeInTheDocument()
  })
})
