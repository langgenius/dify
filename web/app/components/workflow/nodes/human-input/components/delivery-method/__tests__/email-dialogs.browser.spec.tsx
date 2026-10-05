import type { DeliveryMethod } from '../../../types'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import common from '@/i18n/locales/en-US/common.json'
import workflowHumanInput from '@/i18n/locales/en-US/workflow-human-input.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { DeliveryMethodType } from '../../../types'
import DeliveryMethodItem from '../method-item'

vi.mock('react-i18next', async (importOriginal) => importOriginal<typeof import('react-i18next')>())

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }))

const initialMethod: DeliveryMethod = {
  id: 'email-delivery',
  type: DeliveryMethodType.Email,
  enabled: true,
  config: {
    subject: 'Original subject',
    body: '{{#url#}}',
    debug_mode: false,
    recipients: {
      whole_workspace: false,
      items: [{ type: 'external', email: 'reader@example.com' }],
    },
  },
}

function DeliveryMethodOwner({ initial = initialMethod }: { initial?: DeliveryMethod }) {
  const [method, setMethod] = useState(initial)
  return (
    <div className="p-8">
      <DeliveryMethodItem
        nodeId="human-input"
        method={method}
        onChange={setMethod}
        onDelete={vi.fn()}
      />
      <output aria-label="Saved subject">{method.config?.subject}</output>
    </div>
  )
}

async function renderDeliveryMethod(initial = initialMethod) {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, workflow, workflowHumanInput } },
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryWrapper } = createConsoleQueryWrapper()
  queryClient.setQueryData([...commonQueryKeys.members, undefined], { accounts: [] })
  const hooksStore = createHooksStore({})
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryWrapper>
        <HooksStoreContext value={hooksStore}>
          <DeliveryMethodOwner initial={initial} />
        </HooksStoreContext>
      </QueryWrapper>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  sendEmail.mockReset()
  vi.stubGlobal('fetch', sendEmail)
  useAppStore.setState({ appDetail: createAppDetailFixture({ id: 'email-app' }) })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState({ appDetail: undefined })
})

describe('human input email dialog sessions', () => {
  it('opens configuration by keyboard, discards canceled draft, and initializes from saved configuration', async () => {
    const screen = await renderDeliveryMethod()
    const testTrigger = screen.getByRole('button', {
      name: 'Send test emails to your configured recipients',
    })
    const configure = screen.getByRole('button', { name: 'Configure', exact: true })
    await userEvent.tab()
    await expect.element(testTrigger).toHaveFocus()
    await userEvent.tab()
    await expect.element(configure).toHaveFocus()
    await expect
      .poll(() => configure.element().checkVisibility({ opacityProperty: true }))
      .toBe(true)
    await userEvent.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Email Configuration' })
    const subject = dialog.getByRole('textbox', { name: 'Subject', exact: true })
    await expect.element(subject).toHaveValue('Original subject')
    await subject.fill('Canceled draft')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(configure).toHaveFocus()
    await expect
      .poll(() => configure.element().checkVisibility({ opacityProperty: true }))
      .toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect.element(subject).toHaveValue('Original subject')
    await subject.fill('Saved subject')
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('status', { name: 'Saved subject' }))
      .toHaveTextContent('Saved subject')
    await expect.element(configure).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(subject).toHaveValue('Saved subject')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(configure).toHaveFocus()
  })

  it('returns first-time configuration to the surviving Configure entry after saving', async () => {
    const screen = await renderDeliveryMethod({ ...initialMethod, config: undefined })
    await screen.getByRole('button', { name: 'Not configured' }).click()
    const dialog = screen.getByRole('dialog', { name: 'Email Configuration' })
    await dialog.getByRole('textbox', { name: 'Subject', exact: true }).fill('First configuration')
    await dialog.getByRole('switch', { name: 'All members (Workspace)' }).click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    const configure = screen.getByRole('button', { name: 'Configure', exact: true })
    await expect.element(configure).toHaveFocus()
    await expect
      .poll(() => configure.element().checkVisibility({ opacityProperty: true }))
      .toBe(true)
  })

  it('hands test email focus to its sibling configuration and returns to a surviving entry', async () => {
    const screen = await renderDeliveryMethod()
    const trigger = screen.getByRole('button', {
      name: 'Send test emails to your configured recipients',
    })
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    const sender = screen.getByRole('dialog', { name: 'Test Email Sender' })
    await expect.element(sender).toBeVisible()
    await sender.getByRole('button', { name: 'enable Debug Mode' }).click()
    const configure = screen.getByRole('dialog', { name: 'Email Configuration' })
    await expect.element(configure).toBeVisible()
    await expect.element(sender).not.toBeInTheDocument()
    await expect.poll(() => configure.element().contains(document.activeElement)).toBe(true)
    await configure.getByRole('textbox', { name: 'Subject', exact: true }).fill('Discard this')
    await configure.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(configure).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.poll(() => trigger.element().checkVisibility({ opacityProperty: true })).toBe(true)
  })

  it('keeps a pending test open, prevents duplicate send, and resets the completed view on reopening', async () => {
    let finishSend!: (value: Response) => void
    sendEmail.mockReturnValue(
      new Promise((resolve) => {
        finishSend = resolve
      }),
    )
    const screen = await renderDeliveryMethod()
    const trigger = screen.getByRole('button', {
      name: 'Send test emails to your configured recipients',
    })
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    const sender = screen.getByRole('dialog', { name: 'Test Email Sender' })
    const send = sender.getByRole('button', { name: 'Send Email', exact: true })
    await send.click()
    await expect.element(send).toHaveFocus()
    await expect.element(send).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}{Escape}')
    await expect.element(sender).toBeVisible()
    await expect.element(sender.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect.element(sender.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    finishSend(Response.json({ result: 'success' }))
    const done = screen.getByRole('dialog', { name: 'Email Sent' })
    await expect.element(done).toBeVisible()
    await done.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.element(done).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(sender).toBeVisible()
    await expect.element(done).not.toBeInTheDocument()
    await sender.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(sender).not.toBeInTheDocument()
  })
})
