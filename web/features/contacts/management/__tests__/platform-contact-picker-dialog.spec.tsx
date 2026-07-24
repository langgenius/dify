import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementMockProvider } from '../composition'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'
import { PlatformContactPickerDialog } from '../platform-contact-picker-dialog'

describe('PlatformContactPickerDialog pending state', () => {
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
          <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(waits).toHaveLength(1))
    await act(async () => waits.shift()?.())
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    const option = await within(dialog).findByRole('checkbox', { name: /Ada Lovelace/ })
    await user.click(option)
    await user.click(within(dialog).getByRole('button', { name: 'contacts.platformPicker.add' }))
    await waitFor(() => expect(waits).toHaveLength(1))

    expect(option).toBeChecked()
    expect(
      within(dialog).getByRole('button', { name: 'contacts.platformPicker.adding' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => waits.shift()?.())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
