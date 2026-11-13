import type { FileScanProviderResponse } from '@dify/contracts/api/console/file-scan/types.gen'
import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { FileScanSetting } from '../file-scan-setting'

const api = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  listProviders: vi.fn(),
  putPolicy: vi.fn(),
}))

// boundary: the console API transport; generated keys, policies and Query observers stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.fileScanPolicy.get': api.getPolicy,
      'datasets.byDatasetId.fileScanPolicy.put': api.putPolicy,
      'fileScan.providers.get': api.listProviders,
    }),
  }
})

function scanner(overrides: Partial<FileScanProviderResponse> = {}): FileScanProviderResponse {
  return {
    id: 'scanner-1',
    name: 'Office scanner',
    provider_type: 'cloudmersive',
    config: {},
    credentials_set: { api_key: true },
    status: 'active',
    last_error: null,
    last_tested_at: 1_780_000_000,
    created_at: 1_780_000_000,
    policy_count: 0,
    ...overrides,
  }
}

const disabledPolicy = {
  enabled: false,
  provider_id: null,
  on_unavailable: 'block',
  on_unscannable: 'block',
}

async function renderSetting({
  enabled = true,
  providers = [scanner()],
  readonly = false,
  role = 'owner',
}: {
  enabled?: boolean
  providers?: FileScanProviderResponse[]
  readonly?: boolean
  role?: 'normal' | 'owner'
} = {}) {
  api.getPolicy.mockResolvedValue(disabledPolicy)
  api.listProviders.mockResolvedValue({ data: providers })
  api.putPolicy.mockImplementation(async ({ body }: { body: typeof disabledPolicy }) => body)
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role },
    features: { enable_file_scan: enabled },
  })
  await render(
    <ConsoleProvider>
      <FileScanSetting product="dataset" resourceId="dataset-1" readonly={readonly} />
    </ConsoleProvider>,
  )
}

const enableSwitch = () => page.getByRole('switch', { name: 'fileScan.policy.enable' })
const saveButton = () => page.getByRole('button', { name: 'common.operation.save' })

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders nothing and loads nothing while the workspace has the feature turned off', async () => {
  await renderSetting({ enabled: false })

  await expect.element(enableSwitch()).not.toBeInTheDocument()
  expect(api.getPolicy).not.toHaveBeenCalled()
  expect(api.listProviders).not.toHaveBeenCalled()
})

it('starts off, reveals the options when turned on and saves the chosen policy', async () => {
  await renderSetting({
    providers: [scanner(), scanner({ id: 'scanner-2', name: 'Backup scanner', status: 'error' })],
  })
  await expect.element(enableSwitch()).not.toBeChecked()
  await expect.element(enableSwitch()).toBeEnabled()
  await expect.element(page.getByText('fileScan.policy.onUnavailable')).not.toBeInTheDocument()
  await expect.element(saveButton()).not.toBeInTheDocument()

  await enableSwitch().click()
  const unavailable = page.getByRole('radiogroup', { name: 'fileScan.policy.onUnavailable' })
  const unscannable = page.getByRole('radiogroup', { name: 'fileScan.policy.onUnscannable' })
  await expect
    .element(unavailable.getByRole('radio', { name: 'fileScan.policy.block' }))
    .toBeChecked()
  await expect
    .element(unscannable.getByRole('radio', { name: 'fileScan.policy.block' }))
    .toBeChecked()

  // Turning scanning on without a scanner is stopped before it reaches the backend.
  await saveButton().click()
  await expect.element(page.getByText('fileScan.policy.scannerRequired')).toBeVisible()
  expect(api.putPolicy).not.toHaveBeenCalled()

  await page.getByRole('combobox', { name: 'fileScan.policy.scanner' }).click()
  // A scanner whose last check failed stays selectable and is marked.
  await expect
    .element(page.getByRole('option', { name: /Backup scanner.*fileScan\.scanner\.status\.error/ }))
    .toBeVisible()
  await page.getByRole('option', { name: /Office scanner/ }).click()
  await unscannable.getByRole('radio', { name: 'fileScan.policy.allow' }).click()
  await saveButton().click()

  await expect
    .poll(() => api.putPolicy.mock.calls.at(-1)?.[0])
    .toEqual({
      body: {
        enabled: true,
        provider_id: 'scanner-1',
        on_unavailable: 'block',
        on_unscannable: 'allow',
      },
      params: { dataset_id: 'dataset-1' },
    })
  await expect.element(saveButton()).not.toBeInTheDocument()
  await expect.element(enableSwitch()).toBeChecked()
})

it('shows the reason the backend gives when the policy is rejected', async () => {
  await renderSetting()
  api.putPolicy.mockRejectedValue(
    new ORPCError('bad_request', { status: 400, message: 'Scanner "Office scanner" is gone.' }),
  )

  await enableSwitch().click()
  await page.getByRole('combobox', { name: 'fileScan.policy.scanner' }).click()
  await page.getByRole('option', { name: /Office scanner/ }).click()
  await saveButton().click()

  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Scanner "Office scanner" is gone.')
  await expect.element(saveButton()).toBeEnabled()
})

it('tells a member without admin rights to ask an admin when no scanner exists', async () => {
  await renderSetting({ providers: [], role: 'normal' })
  await enableSwitch().click()

  await expect.element(page.getByText('fileScan.policy.noScanners')).toBeVisible()
  await expect
    .element(page.getByRole('link', { name: 'fileScan.policy.openSettings' }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('combobox', { name: 'fileScan.policy.scanner' }))
    .not.toBeInTheDocument()
})

it('links an owner to the scanners in Integrations when no scanner exists', async () => {
  await renderSetting({ providers: [] })
  await enableSwitch().click()

  await expect.element(page.getByText('fileScan.policy.noScannersAdmin')).toBeVisible()
  await expect
    .element(page.getByRole('link', { name: 'fileScan.policy.openSettings' }))
    .toHaveAttribute('href', '/integrations/file-scan')
})

it('cannot be changed by a member who may only view the settings', async () => {
  await renderSetting({ readonly: true })

  await expect.element(enableSwitch()).toBeDisabled()
  await expect.element(saveButton()).not.toBeInTheDocument()
})
