import type { EmailConfig } from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWorkflowEditor as render } from '@/test/workflow-editor'
import EmailConfigureModal from '../email-configure-modal'

const mockToastError = vi.hoisted(() => vi.fn())

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
  toast: { error: mockToastError },
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

const prefix = 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure'

it('saves edited email content with an inserted request URL token', async () => {
  const user = userEvent.setup()
  const handleConfirm = vi.fn()
  render(
    <EmailConfigureModal
      open
      config={createEmailConfig({
        body: 'Draft email body',
        recipients: { whole_workspace: false, items: [] },
      })}
      onOpenChange={vi.fn()}
      onConfirm={handleConfirm}
    />,
  )

  const subject = screen.getByRole('textbox', { name: `${prefix}.subject` })
  await user.clear(subject)
  await user.type(subject, 'Budget alert')
  const body = screen.getByRole('textbox', { name: `${prefix}.body` })
  await user.clear(body)
  await user.paste('Please review {{#url#}} now')
  await waitFor(() => expect(body).toHaveTextContent('Please review'))
  await user.click(screen.getByRole('switch', { name: /emailConfigure.allMembers/ }))
  await user.click(screen.getByRole('switch', { name: `${prefix}.debugMode` }))
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

  expect(handleConfirm).toHaveBeenCalledExactlyOnceWith({
    recipients: { whole_workspace: true, items: [] },
    subject: 'Budget alert',
    body: 'Please review {{#url#}} now',
    debug_mode: true,
  })
})

it.each<{
  scenario: string
  config: Partial<EmailConfig>
  error: string
}>([
  { scenario: 'an empty subject', config: { subject: '' }, error: 'subjectRequired' },
  { scenario: 'a blank body', config: { body: '   ' }, error: 'bodyRequired' },
  {
    scenario: 'a missing request URL',
    config: { body: 'Please review' },
    error: 'bodyMustContainRequestURL',
  },
  {
    scenario: 'no recipients',
    config: { recipients: { whole_workspace: false, items: [] } },
    error: 'recipientsRequired',
  },
])('rejects $scenario without saving', async ({ config, error }) => {
  const user = userEvent.setup()
  const handleConfirm = vi.fn()
  render(
    <EmailConfigureModal
      open
      config={createEmailConfig(config)}
      onOpenChange={vi.fn()}
      onConfirm={handleConfirm}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(mockToastError).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining(`${prefix}.${error}`),
  )
  expect(handleConfirm).not.toHaveBeenCalled()
})

function DismissibleEmailConfig() {
  const [open, setOpen] = useState(true)
  return (
    <EmailConfigureModal
      open={open}
      config={createEmailConfig()}
      onOpenChange={setOpen}
      onConfirm={vi.fn()}
    />
  )
}

it.each(['common.operation.close', 'common.operation.cancel'])(
  'dismisses email configuration through %s',
  async (name) => {
    const user = userEvent.setup()
    render(<DismissibleEmailConfig />)
    await user.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
)
