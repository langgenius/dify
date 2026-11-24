import type { HumanInputContact } from '@dify/contracts/api/console/workspaces/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { channelSummary } from '@/features/contacts/im-platform/__tests__/fixtures/channel-client'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { installFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import { ContactsManagementRuntimeProvider } from '../composition'
import { ContactsDirectoryPage } from '../directory-page'
import { alice, bob } from './fixtures/data'

const identityId = '01a18a00-0000-7000-8000-000000000003'

async function setup(
  contacts: HumanInputContact[] = [alice, bob],
  permissionKeys = ['contact.manage'],
  searchParams = '',
) {
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          humanInput: {
            v2: {
              contacts: {
                get: (input) => {
                  const query = input?.query
                  const data = contacts.filter(
                    (contact) => !query?.group || contact.type === query.group,
                  )
                  const limit = query?.limit ?? 20
                  return { data: data.slice(0, limit), limit, total: data.length, page: 1 }
                },
                byContactId: {
                  get: ({ params }) => ({
                    contact: contacts.find((contact) => contact.id === params.contact_id)!,
                    im_binding_details: [],
                  }),
                  imBindings: {
                    put: ({ params }) => ({
                      contact: contacts.find((contact) => contact.id === params.contact_id)!,
                    }),
                  },
                },
              },
              channels: {
                get: () => ({
                  channels: [
                    channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' }),
                    channelSummary({ id: 'channel-feishu', provider: 'feishu' }),
                  ],
                }),
              },
              imIdentities: {
                get: () => ({
                  data: [
                    {
                      id: identityId,
                      provider: 'feishu',
                      provider_user_id: 'alice-im',
                      binding_status: 'unbound',
                    },
                  ],
                  limit: 20,
                  page: 1,
                  total: 1,
                }),
              },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const queryClient = createTestQueryClient()
  seedCurrentWorkspaceQuery(queryClient, { role: 'normal' })
  seedFeatures(queryClient, { im_centrally_managed: false })
  seedSystemFeatures(queryClient)
  seedWorkspacePermissionsQuery(queryClient, permissionKeys)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter hasMemory searchParams={searchParams}>
        <ContactsManagementRuntimeProvider>
          <div className="isolate h-screen">
            <ContactsDirectoryPage />
          </div>
        </ContactsManagementRuntimeProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  return { screen, queryClient, api: fake.console.workspaces.current.humanInput.v2 }
}

it.each([true, false])(
  'opens details from the full row without consuming selection, with management=%s',
  async (canManage) => {
    await page.viewport(1280, 720)
    const { screen, queryClient } = await setup(
      [alice, bob],
      [canManage ? 'contact.manage' : 'contact.view'],
    )
    try {
      const row = screen.getByRole('row', { name: /Alice/ })
      const trigger = row.getByRole('button', { name: /Alice alice@example.com/ })
      const details = screen.getByRole('region', { name: 'Alice', exact: true })
      await expect.element(trigger).toBeVisible()
      if (canManage) {
        const checkbox = row.getByRole('checkbox')
        await checkbox.click()
        await expect.element(checkbox).toBeChecked()
        await expect.element(details).not.toBeInTheDocument()
        await checkbox.click()
      } else {
        await expect.element(row.getByRole('checkbox')).not.toBeInTheDocument()
        await expect.element(screen.getByText('contacts.directory.viewOnly')).toBeVisible()
      }
      for (const index of [1, 2, 3]) {
        const cell = row.getByRole('cell').nth(index + (canManage ? 1 : 0))
        const rowBounds = row.element().getBoundingClientRect()
        const cellBounds = cell.element().getBoundingClientRect()
        await row.click({
          position: {
            x: cellBounds.right - rowBounds.left - 4,
            y: cellBounds.top - rowBounds.top + cellBounds.height / 2,
          },
        })
        await expect.element(details).toBeVisible()
        await expect
          .element(details.getByRole('heading', { name: 'Alice', exact: true }))
          .toHaveFocus()
        await details.getByRole('button', { name: 'contacts.action.close' }).click()
        await expect.element(details).not.toBeInTheDocument()
        await expect.element(trigger).toHaveFocus()
      }
      await userEvent.keyboard('{Enter}')
      await expect.element(details).toBeVisible()
    } finally {
      queryClient.clear()
    }
  },
)

it('denies the directory and its deep-linked detail to a channel manager without contact permissions', async () => {
  const { screen, queryClient, api } = await setup(
    [alice],
    ['channel.manage'],
    `?contact_id=${alice.id}`,
  )
  try {
    await expect.element(screen.getByText('contacts.directory.noAccessTitle')).toBeVisible()
    expect(api.contacts.get).not.toHaveBeenCalled()
    expect(api.contacts.byContactId.get).not.toHaveBeenCalled()
  } finally {
    queryClient.clear()
  }
})

it('binds an IM identity from the configured workspace channels', async () => {
  const { screen, queryClient, api } = await setup(
    [{ ...alice, type: 'workspace' }],
    ['contact.manage'],
    `?contact_id=${alice.id}`,
  )
  try {
    const panel = screen.getByRole('region', { name: 'Alice', exact: true })
    await panel.getByRole('button', { name: 'contacts.imBinding.bind' }).click()
    const dialog = page.getByRole('dialog', { name: /imBinding.changeTitle.*Feishu/ })
    await dialog.getByRole('combobox', { name: 'contacts.imBinding.contactLabel' }).click()
    await page.getByRole('option', { name: /alice-im/ }).click()
    await dialog.getByRole('button', { name: 'contacts.imBinding.saveBinding' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(api.channels.get).toHaveBeenCalledOnce()
    expect(api.contacts.byContactId.imBindings.put).toHaveBeenCalledWith({
      params: { contact_id: alice.id },
      body: { identity_id: identityId },
    })
  } finally {
    queryClient.clear()
  }
})

it('keeps keyboard-focused final rows above the floating bulk bar', async () => {
  await page.viewport(1280, 500)
  const contacts = Array.from({ length: 20 }, (_, index) => ({
    ...alice,
    id: `contact-${index}`,
    name: `Person ${index}`,
    email: `person${index}@example.com`,
  }))
  const { screen, queryClient } = await setup(contacts)
  try {
    await screen.getByRole('checkbox', { name: /selectContact.*Person 0/ }).click()
    const last = screen.getByRole('button', { name: 'Person 19 person19@example.com' })
    await expect.element(last).toBeVisible()
    last.element().focus()
    await expect.element(last).toHaveFocus()
    const bar = screen.getByRole('button', { name: 'contacts.directory.removeSelected' })
    expect(last.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      bar.element().getBoundingClientRect().top,
    )
  } finally {
    queryClient.clear()
  }
})
