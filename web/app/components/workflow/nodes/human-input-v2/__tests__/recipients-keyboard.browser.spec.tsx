import type { HumanInputV2Recipient } from '../types'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useState } from 'react'
import { useKeyPress } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createTestQueryClient } from '@/test/query-client'
import Recipients from '../components/recipients'
import {
  contact,
  contactApi,
  organizationContact,
  resetContactApi,
  testConsoleQuery,
} from './fixtures/contact-api'

vi.mock('@/service/console', async () => ({
  consoleQuery: (await import('./fixtures/contact-api')).testConsoleQuery,
}))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ trigger }: { trigger: React.ReactElement }) => trigger,
}))

function Harness({ observe }: { observe: (value: HumanInputV2Recipient[]) => void }) {
  // React Flow installs this document-level listener for canvas panning, including when the
  // recipient panel is outside the canvas. Happy DOM's simulated Space click misses its cancellation.
  useKeyPress('Space')
  const [value, setValue] = useState<HumanInputV2Recipient[]>([
    { type: 'contact', contact_id: contact.id },
  ])
  return (
    <Recipients
      nodeId="hitl"
      value={value}
      readonly={false}
      onChange={(next) => {
        setValue(next)
        observe(next)
      }}
    />
  )
}

async function renderRecipients() {
  const client = createTestQueryClient()
  client.setQueryData(testConsoleQuery.workspaces.current.summary.get.queryKey(), {
    id: 'workspace-1',
    name: 'QA workspace',
    role: 'owner',
    plan: null,
    credits: null,
  })
  const store = createStore()
  store.set(queryClientAtom, client)
  const observe = vi.fn()
  await render(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <Harness observe={observe} />
      </QueryClientProvider>
    </Provider>,
  )
  return { client, observe }
}

beforeEach(resetContactApi)

it('preserves native contact-information activation against the canvas Space listener', async () => {
  const { client, observe } = await renderRecipients()
  const info = page.getByRole('button', { name: /recipients.contactInfo.*Evan Zhang/ })
  const dialog = page.getByRole('dialog', { name: contact.name })
  await expect.element(info).toBeVisible()
  info.element().focus()
  await expect.element(info).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).toBeVisible()
  await userEvent.keyboard('{Delete}{Backspace}')
  expect(observe).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(info).toHaveFocus()
  await userEvent.keyboard('{Delete}{Backspace}')
  expect(observe).not.toHaveBeenCalled()
  await userEvent.keyboard(' ')
  await expect.element(dialog).toBeVisible()
  expect(observe).not.toHaveBeenCalled()
  client.clear()
})

it('keeps footer details and the portalled replacement action operable with native Space', async () => {
  contactApi.options.mockResolvedValue({
    data: [contact, { ...organizationContact, email: contact.email }],
    total: 2,
    page: 1,
    limit: 20,
  })
  const { client, observe } = await renderRecipients()
  await page
    .getByRole('button', { name: 'workflow.nodes.humanInputV2.recipients.addContact' })
    .click()
  const conflictingOption = page.getByRole('option', { name: /Amanda Lin/ })
  await expect.element(conflictingOption).toBeVisible()
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(page.getByRole('combobox'))
    .toHaveAttribute(
      'aria-activedescendant',
      page.getByRole('option', { name: /Evan Zhang/ }).element().id,
    )
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(page.getByRole('combobox'))
    .toHaveAttribute('aria-activedescendant', conflictingOption.element().id)
  await userEvent.tab()
  await userEvent.tab()
  const info = page.getByRole('button', { name: 'contacts.details.title' })
  await expect.element(info).toHaveFocus()
  await userEvent.keyboard(' ')
  const dialog = page.getByRole('dialog', { name: organizationContact.name })
  await expect.element(dialog).toBeVisible()
  const replace = dialog.getByRole('button', {
    name: 'workflow.nodes.humanInputV2.recipients.useThisInstead',
  })
  await expect.element(replace).toHaveFocus()
  await userEvent.keyboard(' ')
  expect(observe).toHaveBeenLastCalledWith([
    { type: 'contact', contact_id: organizationContact.id },
  ])
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(page.getByRole('combobox')).toHaveFocus()
  client.clear()
})
