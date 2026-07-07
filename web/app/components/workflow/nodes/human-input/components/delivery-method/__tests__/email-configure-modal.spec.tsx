import type { EmailConfig } from '../../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import EmailConfigureModal from '../email-configure-modal'

const mockToastError = vi.hoisted(() => vi.fn())
const mockUseAppContextSelector = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (message: string) => mockToastError(message),
  },
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { userProfile: { email: string } }) => string) =>
    mockUseAppContextSelector(selector),
}))

vi.mock('../mail-body-input', () => ({
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <textarea
      aria-label="mail-body-input"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

vi.mock('../recipient', () => ({
  default: ({ data, onChange }: {
    data: EmailConfig['recipients']
    onChange: (value: EmailConfig['recipients']) => void
  }) => (
    <div>
      <div data-testid="recipient-state">
        {data.whole_workspace ? 'workspace' : `items:${data.items.length}`}
      </div>
      <button
        type="button"
        onClick={() => onChange({
          whole_workspace: false,
          items: [{ type: 'external', email: 'notify@example.com' }],
        })}
      >
        set-external-recipient
      </button>
      <button
        type="button"
        onClick={() => onChange({
          whole_workspace: true,
          items: [],
        })}
      >
        set-workspace-recipient
      </button>
      <button
        type="button"
        onClick={() => onChange({
          whole_workspace: false,
          items: [],
        })}
      >
        clear-recipient
      </button>
    </div>
  ),
}))

const createEmailConfig = (overrides: Partial<EmailConfig> = {}): EmailConfig => ({
  recipients: {
    whole_workspace: false,
    items: [{ type: 'external', email: 'test@example.com' }],
  },
  subject: 'Original subject',
  body: '{{#url#}}',
  debug_mode: false,
  ...overrides,
})

describe('human-input/delivery-method/email-configure-modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAppContextSelector.mockImplementation(selector => selector({
      userProfile: {
        email: 'owner@example.com',
      },
    }))
  })

  it('should save a valid email configuration with updated values', () => {
    const handleConfirm = vi.fn()

    render(
      <EmailConfigureModal
        open
        config={createEmailConfig()}
        onOpenChange={vi.fn()}
        onConfirm={handleConfirm}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent('nodes.humanInput.deliveryMethod.emailConfigure.debugModeTip1')

    fireEvent.change(screen.getByPlaceholderText('workflow.nodes.humanInput.deliveryMethod.emailConfigure.subjectPlaceholder'), {
      target: { value: 'Budget alert' },
    })
    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: 'Please review {{#url#}} now' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'set-workspace-recipient' }))
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(handleConfirm).toHaveBeenCalledWith({
      recipients: {
        whole_workspace: true,
        items: [],
      },
      subject: 'Budget alert',
      body: 'Please review {{#url#}} now',
      debug_mode: true,
    })
  })

  it('should validate subject, body, request url placeholder, and recipients before saving', () => {
    const handleConfirm = vi.fn()

    render(
      <EmailConfigureModal
        open
        onOpenChange={vi.fn()}
        onConfirm={handleConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith('workflow.nodes.humanInput.deliveryMethod.emailConfigure.subjectRequired')

    fireEvent.change(screen.getByPlaceholderText('workflow.nodes.humanInput.deliveryMethod.emailConfigure.subjectPlaceholder'), {
      target: { value: 'Subject ready' },
    })
    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'set-workspace-recipient' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith('workflow.nodes.humanInput.deliveryMethod.emailConfigure.bodyRequired')

    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: 'Missing placeholder' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('workflow.nodes.humanInput.deliveryMethod.emailConfigure.bodyMustContainRequestURL'))

    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: 'Ready {{#url#}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'clear-recipient' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith('workflow.nodes.humanInput.deliveryMethod.emailConfigure.recipientsRequired')
    expect(handleConfirm).not.toHaveBeenCalled()
  })

  it('should close from both the icon trigger and the cancel button', () => {
    const handleOpenChange = vi.fn()
    render(
      <EmailConfigureModal
        open
        config={createEmailConfig()}
        onOpenChange={handleOpenChange}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('dialog').querySelector('.absolute') as HTMLDivElement)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(handleOpenChange).toHaveBeenCalledTimes(2)
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })
})
