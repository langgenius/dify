import type { EmailConfig } from '../../../types'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { renderWorkflowBrowserComponent as render } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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
  const handleConfirm = vi.fn()
  await render(
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

  const subject = page.getByRole('textbox', { name: `${prefix}.subject` })
  await subject.fill('Budget alert')
  const body = page.getByRole('textbox', { name: `${prefix}.body` })
  await body.fill('Please review {{#url#}} now')
  await expect.element(body.getByText('Please review', { exact: false })).toBeVisible()
  await page.getByRole('switch', { name: /emailConfigure.allMembers/ }).click()
  await page.getByRole('switch', { name: `${prefix}.debugMode` }).click()
  await page.getByRole('button', { name: 'common.operation.save' }).click()

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
  const handleConfirm = vi.fn()
  await render(
    <EmailConfigureModal
      open
      config={createEmailConfig(config)}
      onOpenChange={vi.fn()}
      onConfirm={handleConfirm}
    />,
  )
  await page.getByRole('button', { name: 'common.operation.save' }).click()
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
    await render(<DismissibleEmailConfig />)
    await page.getByRole('button', { name }).click()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  },
)

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
