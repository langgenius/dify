import type {
  FileScanProviderResponse,
  FileScanProviderTypeResponse,
} from '@dify/contracts/api/console/file-scan/types.gen'
import { ORPCError } from '@orpc/client'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { FileScanProviderDialog } from '../scanner-dialog'

const api = vi.hoisted(() => ({
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
}))

// boundary: the console API transport; generated keys, policies and Query observers stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'fileScan.providers.post': api.createProvider,
      'fileScan.providers.byProviderId.patch': api.updateProvider,
    }),
  }
})

const providerTypes: FileScanProviderTypeResponse[] = [
  { provider_type: 'clamav', available: false, credential_fields: [] },
  { provider_type: 'cloudmersive', available: true, credential_fields: ['api_key'] },
  { provider_type: 'scanii', available: true, credential_fields: ['api_key', 'api_secret'] },
  { provider_type: 'metadefender', available: true, credential_fields: ['api_key'] },
  { provider_type: 'api', available: true, credential_fields: [] },
]

function scanner(overrides: Partial<FileScanProviderResponse> = {}): FileScanProviderResponse {
  return {
    id: 'scanner-1',
    name: 'Office scanner',
    provider_type: 'scanii',
    config: { region: 'eu1' },
    credentials_set: { api_key: true, api_secret: true },
    status: 'active',
    last_error: null,
    last_tested_at: null,
    created_at: 1_780_000_000,
    policy_count: 1,
    ...overrides,
  }
}

async function renderDialog(provider?: FileScanProviderResponse) {
  const onSaved = vi.fn()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  await render(
    <ConsoleProvider>
      <NuqsTestingAdapter>
        <FileScanProviderDialog
          open
          provider={provider}
          providerTypes={providerTypes}
          onOpenChange={vi.fn()}
          onSaved={onSaved}
        />
      </NuqsTestingAdapter>
    </ConsoleProvider>,
  )
  return { onSaved }
}

const typeCard = (name: string) => page.getByRole('button', { name, exact: true })
const nameField = () => page.getByRole('textbox', { name: 'fileScan.dialog.name' })
const apiKeyField = () => page.getByLabelText('fileScan.dialog.apiKey')
const apiSecretField = () => page.getByLabelText('fileScan.dialog.apiSecret')
const saveButton = () => page.getByRole('button', { name: 'common.operation.save' })

beforeEach(() => {
  vi.clearAllMocks()
})

it('offers only the available services and swaps the fields with the selected one', async () => {
  await renderDialog()

  // ClamAV is hidden because this deployment did not configure it.
  await expect.element(typeCard('ClamAV')).not.toBeInTheDocument()
  await expect.element(typeCard('Cloudmersive')).toHaveAttribute('aria-pressed', 'true')
  await expect.element(apiKeyField()).toBeVisible()
  await expect.element(page.getByLabelText('fileScan.dialog.endpoint')).toBeVisible()
  await expect.element(apiSecretField()).not.toBeInTheDocument()
  await expect.element(page.getByText('fileScan.dialog.dataNotice')).toBeVisible()

  await typeCard('Scanii').click()
  await expect.element(apiSecretField()).toBeVisible()
  await expect
    .element(page.getByRole('combobox', { name: 'fileScan.dialog.regionLabel' }))
    .toBeVisible()
  await expect.element(page.getByLabelText('fileScan.dialog.endpoint')).not.toBeInTheDocument()

  await typeCard('MetaDefender Cloud').click()
  await expect
    .element(page.getByRole('switch', { name: 'fileScan.dialog.privateProcessing' }))
    .not.toBeChecked()
  await expect.element(apiSecretField()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('combobox', { name: 'fileScan.dialog.regionLabel' }))
    .not.toBeInTheDocument()
})

it('keeps save busy during the live check and shows the backend reason when it fails', async () => {
  const check = createDeferred<FileScanProviderResponse>()
  api.createProvider.mockReturnValue(check.promise)
  const { onSaved } = await renderDialog()

  await typeCard('Scanii').click()
  await nameField().fill('Office scanner')
  await apiKeyField().fill('key-123')
  await apiSecretField().fill('secret-456')
  await page.getByRole('combobox', { name: 'fileScan.dialog.regionLabel' }).click()
  await page.getByRole('option', { name: 'fileScan.dialog.region.eu2' }).click()
  await saveButton().click()

  await expect.element(saveButton()).toBeDisabled()
  expect(api.createProvider).toHaveBeenCalledWith({
    body: {
      name: 'Office scanner',
      provider_type: 'scanii',
      config: { region: 'eu2' },
      credentials: { api_key: 'key-123', api_secret: 'secret-456' },
    },
  })

  check.reject(
    new ORPCError('bad_request', {
      status: 400,
      message: 'Scanii rejected the API key (HTTP 401).',
    }),
  )

  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Scanii rejected the API key (HTTP 401).')
  await expect.element(saveButton()).toBeEnabled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('requires the secrets of a new scanner before it contacts the backend', async () => {
  await renderDialog()

  await nameField().fill('Office scanner')
  await saveButton().click()

  await expect.element(apiKeyField()).toHaveFocus()
  expect(api.createProvider).not.toHaveBeenCalled()
})

it('keeps stored secrets when they are left blank while editing', async () => {
  api.updateProvider.mockImplementation(async () => scanner({ name: 'Renamed scanner' }))
  const { onSaved } = await renderDialog(scanner())

  // The service of an existing scanner cannot be changed.
  await expect.element(typeCard('Cloudmersive')).not.toBeInTheDocument()
  await expect
    .element(apiKeyField())
    .toHaveAttribute('placeholder', 'fileScan.dialog.savedSecretPlaceholder')
  await nameField().fill('Renamed scanner')
  await apiSecretField().fill('rotated-secret')
  await saveButton().click()

  await expect.poll(() => onSaved.mock.calls.length).toBe(1)
  expect(api.updateProvider).toHaveBeenCalledWith({
    params: { provider_id: 'scanner-1' },
    body: {
      name: 'Renamed scanner',
      config: { region: 'eu1' },
      credentials: { api_secret: 'rotated-secret' },
    },
  })
})
