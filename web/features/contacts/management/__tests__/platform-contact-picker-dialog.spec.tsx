import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsManagementMockProvider } from '../composition'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'
import { PlatformContactPickerDialog } from '../platform-contact-picker-dialog'

describe('PlatformContactPickerDialog', () => {
  it('asks before upgrading an External Contact and keeps the selection after cancellation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
        >
          <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    const user = userEvent.setup()
    const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    const option = await within(picker).findByRole('checkbox', { name: /Courtney Henry/ })
    await user.click(option)
    await user.click(within(picker).getByRole('button', { name: 'contacts.platformPicker.add' }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: /contacts\.platformPicker\.upgrade\.title/i,
    })
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'contacts.action.cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', {
          name: /contacts\.platformPicker\.upgrade\.title/i,
        }),
      ).not.toBeInTheDocument()
    })
    expect(option).toBeChecked()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('adds and upgrades the selected External Contact after confirmation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const onOpenChange = vi.fn()
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsManagementMockProvider
          scenario={createContactsMockScenario(ContactsMockScenario.EeMixed)}
        >
          <PlatformContactPickerDialog open onOpenChange={onOpenChange} />
        </ContactsManagementMockProvider>
      </QueryClientProvider>,
    )

    const user = userEvent.setup()
    const picker = screen.getByRole('dialog', { name: 'contacts.platformPicker.title' })
    await user.click(await within(picker).findByRole('checkbox', { name: /Courtney Henry/ }))
    await user.click(within(picker).getByRole('button', { name: 'contacts.platformPicker.add' }))

    const confirmation = await screen.findByRole('alertdialog', {
      name: /contacts\.platformPicker\.upgrade\.title/i,
    })
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'contacts.platformPicker.upgrade.confirm',
      }),
    )

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

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
