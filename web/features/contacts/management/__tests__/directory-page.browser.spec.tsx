import type { HumanInputContact } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { installFakeApi } from '@/test/fake-api'
import { ContactsManagementProvider } from '../composition'
import { ContactsDirectoryPage } from '../directory-page'
import { alice, bob, managerContext } from './fixtures/data'

async function setup(contacts: HumanInputContact[] = [alice, bob], canManage = true) {
  onTestFinished(
    installFakeApi({
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
                  },
                },
                channels: { get: () => ({ channels: [] }) },
              },
            },
          },
        },
      },
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <NuqsTestingAdapter hasMemory>
        <ContactsManagementProvider
          context={{
            ...managerContext,
            permissions: { ...managerContext.permissions, canManageContacts: canManage },
          }}
        >
          <div className="h-screen">
            <ContactsDirectoryPage />
          </div>
        </ContactsManagementProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  return { screen, queryClient }
}

it.each([true, false])(
  'opens details from the full row without consuming selection, with management=%s',
  async (canManage) => {
    await page.viewport(1280, 720)
    const { screen, queryClient } = await setup([alice, bob], canManage)
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
