import type {
  FileScanProviderResponse,
  FileScanProviderTypeResponse,
} from '@dify/contracts/api/console/file-scan/types.gen'
import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { FileScanProvidersPage } from '../scanner-page'

const api = vi.hoisted(() => ({
  deleteProvider: vi.fn(),
  listProviders: vi.fn(),
  listProviderTypes: vi.fn(),
  testProvider: vi.fn(),
}))

// boundary: the console API transport; generated keys, policies and Query observers stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'fileScan.providerTypes.get': api.listProviderTypes,
      'fileScan.providers.byProviderId.delete': api.deleteProvider,
      'fileScan.providers.byProviderId.test.post': api.testProvider,
      'fileScan.providers.get': api.listProviders,
    }),
  }
})

const providerTypes: FileScanProviderTypeResponse[] = [
  { provider_type: 'cloudmersive', available: true, credential_fields: ['api_key'] },
  { provider_type: 'scanii', available: true, credential_fields: ['api_key', 'api_secret'] },
]

function scanner(overrides: Partial<FileScanProviderResponse> = {}): FileScanProviderResponse {
  return {
    id: 'scanner-1',
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

async function renderPage({
  providers = [scanner()],
  role = 'owner',
}: {
  providers?: FileScanProviderResponse[]
  role?: 'normal' | 'owner'
} = {}) {
  api.listProviders.mockResolvedValue({ data: providers })
  api.listProviderTypes.mockResolvedValue({ data: providerTypes })
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({ currentWorkspace: { role } })
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
}

const addButton = () => page.getByRole('button', { name: 'fileScan.scanner.add' })

beforeEach(() => {
  vi.clearAllMocks()
})

it('lists scanners with their state and shows why a failing one failed', async () => {
  await renderPage({
    providers: [
      scanner(),
      scanner({
        id: 'scanner-2',
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

it('is read-only for members who cannot manage the workspace', async () => {
  await renderPage({ role: 'normal' })

  await expect.element(page.getByText('fileScan.scanner.readOnly')).toBeVisible()
  await expect.element(page.getByText('Office scanner')).toBeVisible()
  await expect.element(addButton()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: /fileScan\.scanner\.test/ }))
    .not.toBeInTheDocument()
  expect(api.listProviderTypes).not.toHaveBeenCalled()
})

it('offers a retry when the list cannot be loaded', async () => {
  api.listProviders.mockRejectedValue(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))
  api.listProviderTypes.mockResolvedValue({ data: providerTypes })
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  await render(
    <ConsoleProvider>
      <FileScanProvidersPage layout={({ body }) => <main>{body}</main>} />
    </ConsoleProvider>,
  )

  await expect.element(page.getByText('fileScan.scanner.loadFailed')).toBeVisible()
  api.listProviders.mockResolvedValue({ data: [scanner()] })
  await page.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(page.getByText('Office scanner')).toBeInTheDocument()
})

it('tests a scanner and reports a failed check next to it', async () => {
  api.testProvider.mockRejectedValue(
    new ORPCError('BAD_REQUEST', { status: 400, message: 'Quota exhausted.' }),
  )
  await renderPage()

  await page.getByRole('button', { name: /fileScan\.scanner\.test/ }).click()

  await expect.element(page.getByRole('alert')).toBeVisible()
  expect(api.testProvider).toHaveBeenCalledTimes(1)
  expect(api.testProvider.mock.calls[0]?.[0]).toMatchObject({
    params: { provider_id: 'scanner-1' },
  })
})

it('deletes a scanner only after confirmation', async () => {
  api.deleteProvider.mockResolvedValue({ result: 'success' })
  await renderPage()

  await page.getByRole('button', { name: /common\.operation\.delete/ }).click()
  await expect.element(page.getByText('fileScan.scanner.deleteDescription')).toBeVisible()
  expect(api.deleteProvider).not.toHaveBeenCalled()

  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'common.operation.delete' })
    .click()

  await expect.poll(() => api.deleteProvider.mock.calls.length).toBe(1)
  expect(api.deleteProvider.mock.calls[0]?.[0]).toMatchObject({
    params: { provider_id: 'scanner-1' },
  })
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
