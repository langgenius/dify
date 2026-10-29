import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedAppNetworkAccessGroup, seedNetworkAccessGroups } from '@/test/console/network-access'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { AccessControlEntry } from '..'

vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

async function renderEntry() {
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  seedNetworkAccessGroups(queryClient)
  seedAppNetworkAccessGroup(queryClient, 'app-1')
  const { wrapper: NuqsProvider } = createNuqsTestWrapper()
  return render(
    <ConsoleProvider>
      <NuqsProvider>
        <div style={{ padding: 40 }}>
          <button type="button">Before access control</button>
          <AccessControlEntry
            appMode="chat"
            appId="app-1"
            appIcon={null}
            isPublished={false}
            canEditBinding
          />
        </div>
      </NuqsProvider>
    </ConsoleProvider>,
  )
}

// Unit DOM tests cannot reproduce the native focus-visible state caused by popup autofocus.
it('opens Access Control with the pointer without highlighting the close button', async () => {
  const screen = await renderEntry()
  await screen.getByRole('button', { name: /studio.accessControl.entryLabel/ }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog).toBeVisible()
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(dialog).toHaveFocus()
  expect(close.element().matches(':focus-visible')).toBe(false)
  await close.click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('keeps the Access Control close button visibly focused when opened with the keyboard', async () => {
  const screen = await renderEntry()
  await screen.getByRole('button', { name: 'Before access control' }).click()
  await userEvent.keyboard('{Tab}{Enter}')
  const dialog = screen.getByRole('dialog')
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  expect(close.element().matches(':focus-visible')).toBe(true)
  expect(getComputedStyle(close.element()).boxShadow).not.toBe('none')
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /studio.accessControl.entryLabel/ }))
    .toHaveFocus()
})
