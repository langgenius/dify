import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ContactsDirectoryPage } from '../directory-page'
import { ContactsManagementMockProvider } from './fixtures/composition'
import { ContactsMockScenario, createContactsMockScenario } from './fixtures/scenarios'

it.each([ContactsMockScenario.CeMixed, ContactsMockScenario.ReadOnly])(
  'opens contact details from the whole row in %s without consuming selection or keyboard access',
  async (scenarioName) => {
    // The regression is the native hit target across table cells, which DOM events cannot prove.
    await page.viewport(1280, 720)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const scenario = createContactsMockScenario(scenarioName)
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <NuqsTestingAdapter hasMemory>
          <ContactsManagementMockProvider scenario={scenario}>
            <div className="h-screen">
              <ContactsDirectoryPage />
            </div>
          </ContactsManagementMockProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    )

    try {
      const row = screen.getByRole('row', { name: /Courtney Henry/ })
      const trigger = row.getByRole('button', { name: /Courtney Henry/ })
      const details = screen.getByRole('complementary', { name: 'contacts.details.title' })
      await expect.element(trigger).toBeVisible()

      if (scenario.permissions.canManageContacts) {
        const checkbox = row.getByRole('checkbox', { name: /Courtney Henry/ })
        await checkbox.click()
        await expect.element(checkbox).toBeChecked()
        await expect.element(details).not.toBeInTheDocument()
        await checkbox.click()
      }

      const selectionColumnOffset = scenario.permissions.canManageContacts ? 1 : 0
      for (const columnIndex of [1, 2, 3]) {
        const cell = row.getByRole('cell').nth(columnIndex + selectionColumnOffset)
        const rowBounds = row.element().getBoundingClientRect()
        const cellBounds = cell.element().getBoundingClientRect()
        // Click the right padding too, so a text-only handler cannot satisfy the contract.
        await row.click({
          position: {
            x: cellBounds.right - rowBounds.left - 4,
            y: cellBounds.top - rowBounds.top + cellBounds.height / 2,
          },
        })
        await expect.element(details).toBeVisible()
        await expect.element(details.getByText('Courtney Henry', { exact: true })).toBeVisible()
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
