import type { ReactElement } from 'react'
import type { EmailConfig } from '../../../types'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import EmailConfigureModal from '../email-configure-modal'

const mockToastError = vi.hoisted(() => vi.fn())
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { accountProfile: { email: 'owner@example.com' } })

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': () => ({ accounts: [] }),
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (message: string) => mockToastError(message),
  },
}))

vi.mock('../mail-body-input', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="mail-body-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
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
  })

  it('should save a valid email configuration with updated values', () => {
    const handleConfirm = vi.fn()

    render(
      <EmailConfigureModal
        open
        config={createEmailConfig({ recipients: { whole_workspace: false, items: [] } })}
        onOpenChange={vi.fn()}
        onConfirm={handleConfirm}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'nodes.humanInput.deliveryMethod.emailConfigure.debugModeTip1',
    )

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.subject',
      }),
      {
        target: { value: 'Budget alert' },
      },
    )
    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: 'Please review {{#url#}} now' },
    })
    fireEvent.click(screen.getByRole('switch', { name: /emailConfigure.allMembers/ }))
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.debugMode',
      }),
    )
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

    render(<EmailConfigureModal open onOpenChange={vi.fn()} onConfirm={handleConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith(
      'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.subjectRequired',
    )

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.subject',
      }),
      {
        target: { value: 'Subject ready' },
      },
    )
    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('switch', { name: /emailConfigure.allMembers/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith(
      'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.bodyRequired',
    )

    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: 'Missing placeholder' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining(
        'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.bodyMustContainRequestURL',
      ),
    )

    fireEvent.change(screen.getByLabelText('mail-body-input'), {
      target: { value: 'Ready {{#url#}}' },
    })
    fireEvent.click(screen.getByRole('switch', { name: /emailConfigure.allMembers/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(mockToastError).toHaveBeenCalledWith(
      'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.recipientsRequired',
    )
    expect(handleConfirm).not.toHaveBeenCalled()
  })

  it('should close from both the icon trigger and the cancel button', async () => {
    const handleOpenChange = vi.fn()
    render(
      <EmailConfigureModal
        open
        config={createEmailConfig()}
        onOpenChange={handleOpenChange}
        onConfirm={vi.fn()}
      />,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(handleOpenChange).toHaveBeenCalledTimes(2)
    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })
})
