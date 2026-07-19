import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementMockProvider } from '../composition'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'
import { OrganizationPickerDialog } from '../organization-picker-dialog'

describe('OrganizationPickerDialog pending state', () => {
  it('keeps selection visible and prevents duplicate add while pending', async () => {
    const waits: Array<() => void> = []
    const wait = () =>
      new Promise<void>((resolve) => {
        waits.push(resolve)
      })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
          wait={wait}
        >
          <OrganizationPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(waits).toHaveLength(1))
    await act(async () => waits.shift()?.())
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'contacts.organization.title' })
    const candidate = await within(dialog).findByRole('checkbox', { name: /Ada Lovelace/ })
    await user.click(candidate)
    await user.click(within(dialog).getByRole('button', { name: 'contacts.organization.add' }))
    await waitFor(() => expect(waits).toHaveLength(1))

    expect(candidate).toBeChecked()
    expect(
      within(dialog).getByRole('button', { name: 'contacts.organization.adding' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => waits.shift()?.())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
