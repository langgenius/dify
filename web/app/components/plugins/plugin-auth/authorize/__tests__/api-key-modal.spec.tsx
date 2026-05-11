import type { ApiKeyModalProps } from '../api-key-modal'
import type { FormSchema } from '@/app/components/base/form/types'
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
const mockAddPluginCredential = vi.fn().mockResolvedValue({})
const mockUpdatePluginCredential = vi.fn().mockResolvedValue({})
const defaultCredentialSchemas = [
  { name: 'api_key', label: 'API Key', type: 'secret-input', required: true },
]
type MockFormValues = {
  isCheckValidated: boolean
  values: Record<string, unknown>
}

const defaultFormValues: MockFormValues = { isCheckValidated: true, values: { __name__: 'My Key', api_key: 'sk-123' } }
let mockCredentialSchemas = defaultCredentialSchemas
let mockIsSchemaLoading = false
let mockFormValues = defaultFormValues
const mockAuthFormProps = vi.fn()

vi.mock('../../hooks/use-credential', () => ({
  useAddPluginCredentialHook: () => ({
    mutateAsync: mockAddPluginCredential,
  }),
  useGetPluginCredentialSchemaHook: () => ({
    data: mockCredentialSchemas,
    isLoading: mockIsSchemaLoading,
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
}))

vi.mock('../../../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div data-testid="readme-entrance" />,
}))

vi.mock('@/app/components/base/encrypted-bottom', () => ({
  EncryptedBottom: () => <div data-testid="encrypted-bottom" />,
}))

vi.mock('@/app/components/base/form/form-scenarios/auth', () => {
  const MockAuthForm = ({ ref, ...props }: { ref?: React.Ref<unknown> } & Record<string, unknown>) => {
    mockAuthFormProps(props)
    React.useImperativeHandle(ref, () => ({
      getFormValues: () => mockFormValues,
    }))
    return <div data-testid="auth-form" />
  }

  return {
    default: MockAuthForm,
  }
})

vi.mock('@/app/components/base/form/types', () => ({
  FormTypeEnum: { textInput: 'text-input' },
}))

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

const PopoverModalHarness = ({
  ApiKeyModal,
  onClose,
  onPopoverClose,
}: {
  ApiKeyModal: React.FC<ApiKeyModalProps>
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
      <PopoverTrigger render={<button type="button">Credentials</button>} />
      <PopoverContent>
        <div data-testid="credential-popover">
          <ApiKeyModal
            open={open}
            onOpenChange={setOpen}
            pluginPayload={basePayload}
            onClose={onClose}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

const ControlledModalHarness = ({
  ApiKeyModal,
  onClose,
}: {
  ApiKeyModal: React.FC<ApiKeyModalProps>
  onClose: () => void
}) => {
  const [open, setOpen] = React.useState(true)

  return (
    <>
      <div data-testid="modal-open-state">{String(open)}</div>
      <ApiKeyModal
        open={open}
        onOpenChange={setOpen}
        pluginPayload={basePayload}
        onClose={onClose}
      />
    </>
  )
}

describe('ApiKeyModal', () => {
  let ApiKeyModal: React.FC<ApiKeyModalProps>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockCredentialSchemas = defaultCredentialSchemas
    mockIsSchemaLoading = false
    mockFormValues = defaultFormValues
    mockAddPluginCredential.mockResolvedValue({})
    mockUpdatePluginCredential.mockResolvedValue({})
    const mod = await import('../api-key-modal')
    ApiKeyModal = mod.default
  })

  it('should render modal with correct title', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.getByTestId('modal-title')).toHaveTextContent('plugin.auth.useApiAuth')
  })

  it('should render auth form when data is loaded', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.getByTestId('auth-form')).toBeInTheDocument()
  })

  it('should prefer formSchemas prop and apply schema defaults', () => {
    const customSchemas: FormSchema[] = [
      {
        name: 'custom_api_key',
        label: 'Custom API Key',
        type: 'secret-input' as FormSchema['type'],
        required: true,
        default: 'default-key',
      },
    ]

    render(<ApiKeyModal pluginPayload={basePayload} formSchemas={customSchemas} />)

    expect(mockAuthFormProps).toHaveBeenCalledWith(expect.objectContaining({
      formSchemas: expect.arrayContaining([
        expect.objectContaining({ name: 'custom_api_key' }),
      ]),
      defaultValues: expect.objectContaining({
        custom_api_key: 'default-key',
      }),
    }))
  })

  it('should not render auth form when credential schema is empty', () => {
    mockCredentialSchemas = []

    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.queryByTestId('auth-form')).not.toBeInTheDocument()
  })

  it('should not submit when form ref is unavailable', () => {
    mockCredentialSchemas = []

    render(<ApiKeyModal pluginPayload={basePayload} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    expect(mockAddPluginCredential).not.toHaveBeenCalled()
  })

  it('should disable actions while loading credential schema', () => {
    mockIsSchemaLoading = true

    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.queryByTestId('auth-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('modal-confirm')).toBeDisabled()
  })

  it('should show remove button when editValues is provided', () => {
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing' }} />)

    expect(screen.getByTestId('modal-extra')).toBeInTheDocument()
  })

  it('should not show remove button in add mode', () => {
    render(<ApiKeyModal pluginPayload={basePayload} />)

    expect(screen.queryByTestId('modal-extra')).not.toBeInTheDocument()
  })

  it('should call onClose when close button clicked', () => {
    const mockOnClose = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: /Close|operation.close/ }))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should close through controlled open state when cancel is clicked', async () => {
    const mockOnClose = vi.fn()
    render(<ControlledModalHarness ApiKeyModal={ApiKeyModal} onClose={mockOnClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.getByTestId('modal-open-state')).toHaveTextContent('false')
    })
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should call addPluginCredential on confirm in add mode', async () => {
    const mockOnClose = vi.fn()
    const mockOnUpdate = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} onClose={mockOnClose} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockAddPluginCredential).toHaveBeenCalledWith(expect.objectContaining({
        type: 'api-key',
        name: 'My Key',
      }))
    })
  })

  it('should use empty credential name when authorization name is blank in add mode', async () => {
    mockFormValues = { isCheckValidated: true, values: { api_key: 'sk-123' } }

    render(<ApiKeyModal pluginPayload={basePayload} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockAddPluginCredential).toHaveBeenCalledWith(expect.objectContaining({
        name: '',
      }))
    })
  })

  it('should not submit when form validation fails', () => {
    mockFormValues = { isCheckValidated: false, values: {} }

    render(<ApiKeyModal pluginPayload={basePayload} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    expect(mockAddPluginCredential).not.toHaveBeenCalled()
    expect(mockUpdatePluginCredential).not.toHaveBeenCalled()
  })

  it('should ignore repeated confirm while an action is in progress', async () => {
    let repeatedClickTriggered = false
    mockAddPluginCredential.mockImplementationOnce(async () => {
      if (!repeatedClickTriggered) {
        repeatedClickTriggered = true
        fireEvent.click(screen.getByTestId('modal-confirm'))
      }
      return {}
    })

    render(<ApiKeyModal pluginPayload={basePayload} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockAddPluginCredential).toHaveBeenCalledTimes(1)
    })
  })

  it('should call updatePluginCredential on confirm in edit mode', async () => {
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing', __credential_id__: 'cred-1' }} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockUpdatePluginCredential).toHaveBeenCalled()
    })
  })

  it('should use empty credential name when authorization name is blank in edit mode', async () => {
    mockFormValues = { isCheckValidated: true, values: { api_key: 'updated', __credential_id__: 'cred-1' } }

    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing', __credential_id__: 'cred-1' }} />)

    fireEvent.click(screen.getByTestId('modal-confirm'))

    await waitFor(() => {
      expect(mockUpdatePluginCredential).toHaveBeenCalledWith(expect.objectContaining({
        name: '',
      }))
    })
  })

  it('should call onRemove when remove button clicked', () => {
    const mockOnRemove = vi.fn()
    render(<ApiKeyModal pluginPayload={basePayload} editValues={{ api_key: 'existing' }} onRemove={mockOnRemove} />)

    fireEvent.click(screen.getByTestId('modal-extra'))
    expect(mockOnRemove).toHaveBeenCalled()
  })

  it('should stay open when clicking inside the modal from a popover', async () => {
    // Use userEvent instead of fireEvent to avoid CI flakiness: userEvent
    // awaits React act() between pointer/mouse/click so base-ui's dialog
    // popup ref is guaranteed committed before outside-click detection runs.
    const user = userEvent.setup()
    const mockOnClose = vi.fn()
    const mockOnPopoverClose = vi.fn()

    render(
      <PopoverModalHarness
        ApiKeyModal={ApiKeyModal}
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

  it('should close on backdrop click through controlled open state', async () => {
    const mockOnClose = vi.fn()
    render(<ControlledModalHarness ApiKeyModal={ApiKeyModal} onClose={mockOnClose} />)

    const backdrop = document.querySelector('.bg-background-overlay')
    if (!backdrop)
      throw new Error('Expected dialog backdrop to render')

    fireEvent.pointerDown(backdrop)
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)

    await waitFor(() => {
      expect(screen.getByTestId('modal-open-state')).toHaveTextContent('false')
    })
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should close on backdrop click when nested inside another dialog', async () => {
    const mockOnClose = vi.fn()
    render(
      <Dialog open>
        <DialogContent backdropClassName="bg-transparent">
          <ControlledModalHarness ApiKeyModal={ApiKeyModal} onClose={mockOnClose} />
        </DialogContent>
      </Dialog>,
    )

    const backdrop = document.querySelector('.bg-background-overlay')
    expect(backdrop).toBeInTheDocument()

    fireEvent.pointerDown(backdrop!)
    fireEvent.mouseDown(backdrop!)
    fireEvent.click(backdrop!)

    await waitFor(() => {
      expect(screen.getByTestId('modal-open-state')).toHaveTextContent('false')
    })
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should render readme entrance when detail is provided', () => {
    const payload = { ...basePayload, detail: { name: 'Test' } as never }
    render(<ApiKeyModal pluginPayload={payload} />)

    expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
  })
})
