import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { CreateFromDSLModal } from '../index'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []

function Session() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File>()
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFile(new File(['app: first'], 'first.yml'))
          setOpen(true)
        }}
      >
        Open first file
      </button>
      <button
        type="button"
        onClick={() => {
          setFile(new File(['app: next'], 'next.yml'))
          setOpen(true)
        }}
      >
        Open next file
      </button>
      <CreateFromDSLModal
        open={open}
        droppedFile={file}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setFile(undefined)
        }}
      />
    </>
  )
}

beforeEach(async () => {
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
  await page.viewport(1200, 900)
  transport.mockReset()
})

afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = true
})

it('keeps version confirmation inside the file session and retains the file through final exit', async () => {
  let finishConfirmation!: (response: { id: string; status: string; error: string }) => void
  const confirmation = new Promise<{ id: string; status: string; error: string }>((resolve) => {
    finishConfirmation = resolve
  })
  transport.mockImplementation((path: string[]) => {
    const operation = path.join('.')
    if (operation === 'apps.imports.post')
      return Promise.resolve({
        id: 'import-session',
        status: 'pending',
        imported_dsl_version: '1.0',
        current_dsl_version: '2.0',
      })
    if (operation === 'apps.imports.byImportId.confirm.post') return confirmation
    throw new Error(`Unexpected request: ${operation}`)
  })
  const calls = (path: string) => transport.mock.calls.filter(([parts]) => parts.join('.') === path)
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { apps: { size: 0, limit: 10 } },
  })
  clients.push(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Session />
    </QueryClientTestProvider>,
  )
  const firstEntry = screen.getByRole('button', { name: 'Open first file' })
  await firstEntry.click()
  await page.getByRole('button', { name: /common.operation.create/ }).click()
  const alert = page.getByRole('alertdialog')
  await expect.element(alert).toBeVisible()
  const confirm = alert.getByRole('button', { name: 'app.newApp.Confirm' })
  await confirm.click()
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{Escape}')
  await expect.element(alert).toBeVisible()
  expect(calls('apps.imports.byImportId.confirm.post')).toHaveLength(1)
  expect(calls('apps.imports.post')).toHaveLength(1)

  finishConfirmation({ id: 'import-session', status: 'failed', error: 'Version not accepted' })
  await expect.element(confirm).not.toHaveAttribute('aria-disabled', 'true')
  await alert.getByRole('button', { name: 'app.newApp.Cancel' }).click()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  const parent = page.getByRole('dialog', { name: 'app.importApp', exact: true })
  await expect.element(parent.getByText('first.yml', { exact: true })).toBeVisible()
  await expect
    .element(parent.getByRole('button', { name: /common.operation.create/ }))
    .toHaveFocus()

  await parent.getByRole('button', { name: /common.operation.create/ }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect.element(parent.getByText('first.yml', { exact: true })).toBeVisible()
  expect(calls('apps.imports.post')).toHaveLength(2)
  expect(calls('apps.imports.byImportId.confirm.post')).toHaveLength(1)

  const popup = parent.element()
  const filename = parent.getByText('first.yml', { exact: true }).element()
  const exitFiles: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitFiles.push(filename.isConnected && filename.textContent === 'first.yml')
  })
  await parent.getByRole('button', { name: 'app.newApp.Cancel' }).click()
  await expect.poll(() => exitFiles.length).toBeGreaterThan(0)
  expect(exitFiles.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(firstEntry).toHaveFocus()
  await screen.getByRole('button', { name: 'Open next file' }).click()
  await expect
    .element(page.getByRole('dialog').getByText('next.yml', { exact: true }))
    .toBeVisible()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
})
