import type {
  FileScanProviderResponse,
  FileScanProviderTypeResponse,
} from '@dify/contracts/api/console/file-scan/types.gen'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, installFakeApi } from '@/test/fake-api'
import { FileScanProvidersPage } from '../scanner-page'

// Provider ids are UUIDs in the contract.
const scannerId = '00000000-0000-4000-8000-000000000001'

const providerTypes: FileScanProviderTypeResponse[] = [
  { provider_type: 'cloudmersive', available: true, credential_fields: ['api_key'] },
  { provider_type: 'scanii', available: true, credential_fields: ['api_key', 'api_secret'] },
]

function scanner(overrides: Partial<FileScanProviderResponse> = {}): FileScanProviderResponse {
  return {
    id: scannerId,
    name: 'Office scanner',
    provider_type: 'cloudmersive',
    config: {},
    credentials_set: { api_key: true },
    status: 'active',
    last_error: null,
    last_tested_at: null,
    created_at: 1_780_000_000,
    policy_count: 2,
    ...overrides,
  }
}

function installScannerApi(providers = [scanner()]) {
  const fake = installFakeApi({
    console: {
      fileScan: {
        providerTypes: { get: () => ({ data: providerTypes }) },
        providers: {
          get: () => ({ data: providers }),
          byProviderId: {
            delete: () => {},
            test: { post: () => scanner() },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  return fake
}

async function renderPage({
  providers = [scanner()],
  canManage = true,
  role = 'normal',
}: {
  canManage?: boolean
  providers?: FileScanProviderResponse[]
  role?: 'normal' | 'owner'
} = {}) {
  const fake = installScannerApi(providers)
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role },
    workspacePermissionKeys: canManage ? ['credential.manage'] : [],
  })
  await render(
    <ConsoleProvider>
      <FileScanProvidersPage
        layout={({ body, toolbar }) => (
          <div>
            <header>{toolbar}</header>
            <main>{body}</main>
          </div>
        )}
      />
    </ConsoleProvider>,
  )
  return fake.console.fileScan
}

const addButton = () => page.getByRole('button', { name: 'fileScan.scanner.add' })

it('lists scanners with their state and shows why a failing one failed', async () => {
  await renderPage({
    providers: [
      scanner(),
      scanner({
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Backup scanner',
        provider_type: 'scanii',
        status: 'error',
        last_error: 'The API key was rejected.',
        last_tested_at: 1_780_000_000,
      }),
    ],
  })

  // The action labels are untranslated keys here and squeeze the truncated name, so presence is asserted.
  await expect.element(page.getByText('Office scanner')).toBeInTheDocument()
  await expect.element(page.getByText('Backup scanner')).toBeInTheDocument()
  await expect.element(page.getByText('fileScan.scanner.status.active')).toBeVisible()
  await expect.element(page.getByText('fileScan.scanner.status.error')).toBeVisible()
  await expect.element(page.getByText('fileScan.scanner.neverTested')).toBeVisible()
  await expect.element(page.getByText(/fileScan\.scanner\.lastTested/)).toBeVisible()
  await expect.element(addButton()).toBeEnabled()
})

it('tells an empty workspace that no scanner is configured', async () => {
  await renderPage({ providers: [] })

  await expect.element(page.getByText('fileScan.scanner.empty')).toBeVisible()
})

// The legacy role is not consulted: with RBAC it no longer says who may manage credentials.
it('is read-only for an owner who lacks the credential permission', async () => {
  const fileScan = await renderPage({ canManage: false, role: 'owner' })

  await expect.element(page.getByText('fileScan.scanner.readOnly')).toBeVisible()
  await expect.element(page.getByText('Office scanner')).toBeVisible()
  await expect.element(addButton()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: /fileScan\.scanner\.test/ }))
    .not.toBeInTheDocument()
  expect(fileScan.providerTypes.get).not.toHaveBeenCalled()
})

it('offers a retry when the list cannot be loaded', async () => {
  installScannerApi().console.fileScan.providers.get.mockRejectedValueOnce(
    apiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }),
  )
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    workspacePermissionKeys: ['credential.manage'],
  })
  await render(
    <ConsoleProvider>
      <FileScanProvidersPage layout={({ body }) => <main>{body}</main>} />
    </ConsoleProvider>,
  )

  await expect.element(page.getByText('fileScan.scanner.loadFailed')).toBeVisible()
  await page.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(page.getByText('Office scanner')).toBeInTheDocument()
})

it('tests a scanner and reports a failed check next to it', async () => {
  const { providers } = await renderPage()
  providers.byProviderId.test.post.mockRejectedValueOnce(
    apiError({ status: 400, code: 'BAD_REQUEST', message: 'Quota exhausted.' }),
  )

  await page.getByRole('button', { name: /fileScan\.scanner\.test/ }).click()

  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(providers.byProviderId.test.post).toHaveBeenCalledTimes(1)
  expect(providers.byProviderId.test.post).toHaveBeenCalledWith(
    expect.objectContaining({ params: { provider_id: scannerId } }),
  )
})

it('deletes a scanner only after confirmation', async () => {
  const { providers } = await renderPage()

  await page.getByRole('button', { name: /common\.operation\.delete/ }).click()
  await expect.element(page.getByText('fileScan.scanner.deleteDescription')).toBeVisible()
  expect(providers.byProviderId.delete).not.toHaveBeenCalled()

  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'common.operation.delete' })
    .click()

  await expect.poll(() => providers.byProviderId.delete.mock.calls.length).toBe(1)
  expect(providers.byProviderId.delete).toHaveBeenCalledWith(
    expect.objectContaining({ params: { provider_id: scannerId } }),
  )
})

it('opens the dialog to add a scanner and to edit an existing one', async () => {
  await renderPage()

  await addButton().click()
  await expect.element(page.getByRole('textbox', { name: 'fileScan.dialog.name' })).toHaveValue('')
  await page.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect
    .element(page.getByRole('textbox', { name: 'fileScan.dialog.name' }))
    .not.toBeInTheDocument()

  await page.getByRole('button', { name: /common\.operation\.edit/ }).click()
  await expect
    .element(page.getByRole('textbox', { name: 'fileScan.dialog.name' }))
    .toHaveValue('Office scanner')
})
