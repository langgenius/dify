import type {
  FileScanProviderResponse,
  FileScanProviderTypeResponse,
} from '@dify/contracts/api/console/file-scan/types.gen'
import { ORPCError } from '@orpc/client'
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
  { provider_type: 'api', available: true, credential_fields: ['api_key'] },
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
      <FileScanProviderDialog
        open
        provider={provider}
        providerTypes={providerTypes}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />
    </ConsoleProvider>,
  )
  return { onSaved }
}

const typeCard = (name: string) => page.getByRole('button', { name, exact: true })
const nameField = () => page.getByRole('textbox', { name: 'fileScan.dialog.name' })
const apiKeyField = () => page.getByLabelText('fileScan.dialog.apiKey')
const apiSecretField = () => page.getByLabelText('fileScan.dialog.apiSecret')
const endpointUrlField = () => page.getByLabelText('fileScan.dialog.endpointUrl')
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

  // A custom endpoint is configured right here: its address and its key.
  await typeCard('fileScan.type.customEndpoint').click()
  await expect.element(endpointUrlField()).toBeVisible()
  await expect.element(apiKeyField()).toBeVisible()
  await expect.element(page.getByText('fileScan.dialog.endpointUrlDescription')).toBeVisible()
  await expect.element(page.getByText('fileScan.dialog.dataNotice')).toBeVisible()
})

it('links to the page where the selected cloud vendor issues API keys', async () => {
  await renderDialog()
  const keyLink = (vendor: string) =>
    page.getByRole('link', { name: `fileScan.dialog.getApiKey:{"vendor":"${vendor}"}` })
  const anyKeyLink = () => page.getByRole('link', { name: /fileScan\.dialog\.getApiKey/ })

  await expect
    .element(keyLink('Cloudmersive'))
    .toHaveAttribute('href', 'https://portal.cloudmersive.com/keys')
  await expect.element(keyLink('Cloudmersive')).toHaveAttribute('target', '_blank')

  await typeCard('Scanii').click()
  await expect.element(keyLink('Scanii')).toHaveAttribute('href', 'https://www.scanii.com/accounts')
  await expect.element(keyLink('Cloudmersive')).not.toBeInTheDocument()

  await typeCard('MetaDefender Cloud').click()
  await expect
    .element(keyLink('MetaDefender Cloud'))
    .toHaveAttribute('href', 'https://metadefender.opswat.com/account')

  // A custom endpoint has no vendor to get a key from.
  await typeCard('fileScan.type.customEndpoint').click()
  await expect.element(anyKeyLink()).not.toBeInTheDocument()
})

it.each([
  ['clamav', false],
  ['scanii', true],
])('shows the key link when editing a %s scanner: %s', async (type, shown) => {
  await renderDialog(scanner({ provider_type: type }))
  const link = page.getByRole('link', { name: /fileScan\.dialog\.getApiKey/ })

  await expect.element(saveButton()).toBeVisible()
  if (shown) await expect.element(link).toHaveAttribute('href', 'https://www.scanii.com/accounts')
  else await expect.element(link).not.toBeInTheDocument()
})

it('saves a custom endpoint only once its address is an http or https URL', async () => {
  api.createProvider.mockImplementation(async () => scanner({ provider_type: 'api' }))
  const { onSaved } = await renderDialog()

  await typeCard('fileScan.type.customEndpoint').click()
  await nameField().fill('In-house scanner')
  await apiKeyField().fill('key-123')
  await endpointUrlField().fill('ftp://scanner.example.com/scan')
  await saveButton().click()

  await expect.element(page.getByText('fileScan.dialog.endpointUrlInvalid')).toBeVisible()
  expect(api.createProvider).not.toHaveBeenCalled()

  await endpointUrlField().fill(' https://scanner.example.com/scan ')
  await saveButton().click()

  await expect.poll(() => onSaved.mock.calls.length).toBe(1)
  expect(api.createProvider).toHaveBeenCalledWith({
    body: {
      name: 'In-house scanner',
      provider_type: 'api',
      config: { endpoint: 'https://scanner.example.com/scan' },
      credentials: { api_key: 'key-123' },
    },
  })
})

it.each([
  ['api', 'fileScan.dialog.endpointUrl'],
  ['cloudmersive', 'fileScan.dialog.endpoint'],
])('asks for the API key again when the address of a %s scanner changes', async (type, label) => {
  api.updateProvider.mockRejectedValue(
    new ORPCError('bad_request', {
      status: 400,
      message: 'The scanner at the new address rejected the API key.',
    }),
  )
  await renderDialog(
    scanner({
      provider_type: type,
      config: { endpoint: 'https://old.example.com/scan' },
      credentials_set: { api_key: true },
    }),
  )
  const address = page.getByLabelText(label)

  await expect
    .element(apiKeyField())
    .toHaveAttribute('placeholder', 'fileScan.dialog.savedSecretPlaceholder')
  await expect.element(page.getByText('fileScan.dialog.reenterApiKey')).not.toBeInTheDocument()

  await address.fill('https://new.example.com/scan')
  await expect.element(page.getByText('fileScan.dialog.reenterApiKey')).toBeVisible()
  await expect.element(apiKeyField()).not.toHaveAttribute('placeholder')
  await saveButton().click()

  await expect.element(apiKeyField()).toHaveFocus()
  expect(api.updateProvider).not.toHaveBeenCalled()

  await apiKeyField().fill('key-for-new-address')
  await saveButton().click()

  await expect
    .poll(() => api.updateProvider.mock.calls.at(-1)?.[0])
    .toEqual({
      params: { provider_id: 'scanner-1' },
      body: {
        name: 'Office scanner',
        config: { endpoint: 'https://new.example.com/scan' },
        credentials: { api_key: 'key-for-new-address' },
      },
    })
  // Whatever the backend still objects to is shown where the user acted.
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('The scanner at the new address rejected the API key.')
})

it('keeps the stored key of a custom endpoint whose address is unchanged', async () => {
  api.updateProvider.mockImplementation(async () => scanner({ provider_type: 'api' }))
  const { onSaved } = await renderDialog(
    scanner({
      provider_type: 'api',
      config: { endpoint: 'https://old.example.com/scan' },
      credentials_set: { api_key: true },
    }),
  )

  await nameField().fill('Renamed scanner')
  await saveButton().click()

  await expect.poll(() => onSaved.mock.calls.length).toBe(1)
  expect(api.updateProvider).toHaveBeenCalledWith({
    params: { provider_id: 'scanner-1' },
    body: { name: 'Renamed scanner', config: { endpoint: 'https://old.example.com/scan' } },
  })
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
