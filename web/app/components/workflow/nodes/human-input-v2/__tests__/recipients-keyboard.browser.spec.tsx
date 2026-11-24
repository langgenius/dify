import type { HumanInputV2Recipient } from '../types'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useState } from 'react'
import { ReactFlowProvider, useKeyPress } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { installFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import { WorkflowContext } from '../../../context'
import { EditorResourceScope } from '../../../editor-resource/provider'
import { HooksStoreContextProvider } from '../../../hooks-store/provider'
import { createWorkflowStore } from '../../../store/workflow'
import Recipients from '../components/recipients'
import { contact, contactApi, organizationContact, resetContactApi } from './fixtures/contact-api'

function Harness({
  initial = [{ type: 'contact', contact_id: contact.id }],
  observe,
}: {
  initial?: HumanInputV2Recipient[]
  observe: (value: HumanInputV2Recipient[]) => void
}) {
  // React Flow installs this document-level listener for canvas panning, including when the
  // recipient panel is outside the canvas. Happy DOM's simulated Space click misses its cancellation.
  useKeyPress('Space')
  const [value, setValue] = useState(initial)
  return (
    <Recipients
      nodeId="hitl"
      value={value}
      readonly={false}
      isTriggerMode={false}
      onChange={(next) => {
        setValue(next)
        observe(next)
      }}
    />
  )
}

async function renderRecipients(initial?: HumanInputV2Recipient[]) {
  onTestFinished(
    installFakeApi({
      console: {
        features: { get: () => contactApi.features() },
        spec: { schemaDefinitions: { get: () => [] } },
        workspaces: {
          current: {
            tools: {
              builtin: { get: () => [] },
              api: { get: () => [] },
              workflow: { get: () => [] },
              mcp: { get: () => [] },
            },
            summary: {
              get: () => ({
                id: 'workspace-1',
                name: 'QA workspace',
                role: 'owner',
                plan: null,
                credits: null,
              }),
            },
            humanInput: {
              v2: {
                contacts: { get: () => contactApi.contacts() },
                contactOptions: {
                  get: (input) => contactApi.options({ query: input?.query ?? {} }),
                  batch: { get: (input) => contactApi.batch(input) },
                },
              },
            },
          },
        },
      },
    }),
  )
  const client = createTestQueryClient()
  const store = createStore()
  store.set(queryClientAtom, client)
  const observe = vi.fn()
  await render(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <ReactFlowProvider>
          <WorkflowContext value={createWorkflowStore({})}>
            <HooksStoreContextProvider>
              <EditorResourceScope
                resource={{
                  kind: 'app',
                  collaborationEnabled: false,
                  appId: 'app-1',
                  mode: 'workflow',
                }}
              >
                <Harness initial={initial} observe={observe} />
              </EditorResourceScope>
            </HooksStoreContextProvider>
          </WorkflowContext>
        </ReactFlowProvider>
      </QueryClientProvider>
    </Provider>,
  )
  return { client, observe }
}

beforeEach(resetContactApi)

it('shows information for one-time email and all-workspace recipients saved by migration', async () => {
  const { client, observe } = await renderRecipients([
    { type: 'onetime_email', email: 'approver@example.com' },
    { type: 'all_workspace_contacts' },
    { type: 'initiator' },
  ])
  await page.getByRole('button', { name: /recipients.contactInfo.*approver@example\.com/ }).click()
  const email = page.getByRole('dialog', {
    name: 'workflow.nodes.humanInputV2.recipients.emailLabel',
  })
  await expect.element(email.getByText('approver@example.com')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(email).not.toBeInTheDocument()

  await page.getByRole('button', { name: /recipients.contactInfo.*QA workspace/ }).click()
  const workspace = page.getByRole('dialog', { name: 'QA workspace' })
  await expect
    .element(
      workspace.getByText('workflow.nodes.humanInputV2.recipients.allWorkspaceContactsDescription'),
    )
    .toBeVisible()
  expect(observe).not.toHaveBeenCalled()
  client.clear()
})

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
  await expect.element(dialog).toBeVisible()
  expect(observe).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(info).toHaveFocus()
  await userEvent.keyboard('{Delete}{Backspace}')
  await expect.element(info).toHaveFocus()
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
