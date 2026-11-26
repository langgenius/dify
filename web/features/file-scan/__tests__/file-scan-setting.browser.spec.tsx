import type { FileScanPolicyResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { FileScanProviderResponse } from '@dify/contracts/api/console/file-scan/types.gen'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, installFakeApi } from '@/test/fake-api'
import { FileScanSetting } from '../file-scan-setting'
import { useFileScanPolicyController } from '../use-file-scan-policy'

// Dataset ids are UUIDs in the contract.
const datasetId = '00000000-0000-4000-8000-000000000001'

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

const disabledPolicy: FileScanPolicyResponse = {
  enabled: false,
  provider_id: null,
  on_unavailable: 'block',
  on_unscannable: 'block',
}

/** Stands in for a settings page: it owns the only Save and Cancel buttons. */
function SettingsPage({ readonly }: { readonly: boolean }) {
  const fileScan = useFileScanPolicyController({
    product: 'dataset',
    readonly,
    resourceId: datasetId,
  })
  const [result, setResult] = useState('')

  return (
    <div>
      <FileScanSetting controller={fileScan} />
      <button
        type="button"
        onClick={() => void fileScan.save().then((result) => setResult(result.status))}
      >
        page save
      </button>
      <button type="button" onClick={fileScan.reset}>
        page cancel
      </button>
      <output aria-label="draft">{fileScan.dirty ? 'dirty' : 'clean'}</output>
      <output aria-label="result">{result}</output>
    </div>
  )
}

async function renderSetting({
  enabled = true,
  providers = [scanner()],
  readonly = false,
  canManageScanners = true,
}: {
  enabled?: boolean
  providers?: FileScanProviderResponse[]
  readonly?: boolean
  canManageScanners?: boolean
} = {}) {
  const fake = installFakeApi({
    console: {
      datasets: {
        byDatasetId: {
          fileScanPolicy: {
            get: () => disabledPolicy,
            put: ({ body }) => ({ ...disabledPolicy, ...body }),
          },
        },
      },
      fileScan: { providers: { get: () => ({ data: providers }) } },
    },
  })
  onTestFinished(fake)
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    // The legacy role stays 'normal': only the credential permission decides who manages scanners.
    currentWorkspace: { role: 'normal' },
    workspacePermissionKeys: canManageScanners ? ['credential.manage'] : [],
    features: { enable_file_scan: enabled },
  })
  await render(
    <ConsoleProvider>
      <SettingsPage readonly={readonly} />
    </ConsoleProvider>,
  )
  const { fileScanPolicy } = fake.console.datasets.byDatasetId
  return {
    getPolicy: fileScanPolicy.get,
    putPolicy: fileScanPolicy.put,
    listProviders: fake.console.fileScan.providers.get,
  }
}

const enableSwitch = () => page.getByRole('switch', { name: 'fileScan.policy.enable' })
const ownSaveButton = () => page.getByRole('button', { name: 'common.operation.save' })
const pageSave = () => page.getByRole('button', { name: 'page save' })
const draftState = () => page.getByRole('status', { name: 'draft' })
const saveResult = () => page.getByRole('status', { name: 'result' })

it('renders nothing and loads nothing while the workspace has the feature turned off', async () => {
  const { getPolicy, listProviders } = await renderSetting({ enabled: false })

  await expect.element(enableSwitch()).not.toBeInTheDocument()
  expect(getPolicy).not.toHaveBeenCalled()
  expect(listProviders).not.toHaveBeenCalled()
})

it('starts off, reveals the options when turned on and saves the chosen policy', async () => {
  const { getPolicy, putPolicy } = await renderSetting({
    providers: [scanner(), scanner({ id: 'scanner-2', name: 'Backup scanner', status: 'error' })],
  })
  await expect.element(enableSwitch()).not.toBeChecked()
  await expect.element(enableSwitch()).toBeEnabled()
  await expect.element(page.getByText('fileScan.policy.onUnavailable')).not.toBeInTheDocument()
  await expect.element(draftState()).toHaveTextContent('clean')

  // Saving an untouched section sends nothing.
  await pageSave().click()
  await expect.element(draftState()).toHaveTextContent('clean')
  await expect.element(saveResult()).toHaveTextContent('unchanged')
  expect(putPolicy).not.toHaveBeenCalled()

  await enableSwitch().click()
  // The section has no Save button of its own: the page saves it.
  await expect.element(ownSaveButton()).not.toBeInTheDocument()
  await expect.element(draftState()).toHaveTextContent('dirty')
  const unavailable = page.getByRole('radiogroup', { name: 'fileScan.policy.onUnavailable' })
  const unscannable = page.getByRole('radiogroup', { name: 'fileScan.policy.onUnscannable' })
  await expect
    .element(unavailable.getByRole('radio', { name: 'fileScan.policy.block' }))
    .toBeChecked()
  await expect
    .element(unscannable.getByRole('radio', { name: 'fileScan.policy.block' }))
    .toBeChecked()

  // Turning scanning on without a scanner is stopped before it reaches the backend.
  await pageSave().click()
  await expect.element(page.getByText('fileScan.policy.scannerRequired')).toBeVisible()
  await expect.element(draftState()).toHaveTextContent('dirty')
  await expect.element(saveResult()).toHaveTextContent('invalid')
  expect(putPolicy).not.toHaveBeenCalled()

  await page.getByRole('combobox', { name: 'fileScan.policy.scanner' }).click()
  // A scanner whose last check failed stays selectable and is marked.
  await expect
    .element(page.getByRole('option', { name: /Backup scanner.*fileScan\.scanner\.status\.error/ }))
    .toBeVisible()
  await page.getByRole('option', { name: /Office scanner/ }).click()
  await unscannable.getByRole('radio', { name: 'fileScan.policy.allow' }).click()
  getPolicy.mockReturnValue({
    enabled: true,
    provider_id: 'scanner-1',
    on_unavailable: 'block',
    on_unscannable: 'allow',
  })
  await pageSave().click()

  await expect
    .poll(() => putPolicy.mock.calls.at(-1)?.[0])
    .toEqual({
      body: {
        enabled: true,
        provider_id: 'scanner-1',
        on_unavailable: 'block',
        on_unscannable: 'allow',
      },
      params: { dataset_id: datasetId },
    })
  await expect.element(draftState()).toHaveTextContent('clean')
  await expect.element(saveResult()).toHaveTextContent('saved')
  await expect.element(enableSwitch()).toBeChecked()
})

it('drops the unsaved changes when the page cancels', async () => {
  const { putPolicy } = await renderSetting()

  await enableSwitch().click()
  await expect.element(draftState()).toHaveTextContent('dirty')
  await page.getByRole('button', { name: 'page cancel' }).click()

  await expect.element(enableSwitch()).not.toBeChecked()
  await expect.element(draftState()).toHaveTextContent('clean')
  expect(putPolicy).not.toHaveBeenCalled()
})

it('shows the reason the backend gives when the policy is rejected', async () => {
  const { putPolicy } = await renderSetting()
  putPolicy.mockRejectedValue(
    apiError({ status: 400, code: 'bad_request', message: 'Scanner "Office scanner" is gone.' }),
  )

  await enableSwitch().click()
  await page.getByRole('combobox', { name: 'fileScan.policy.scanner' }).click()
  await page.getByRole('option', { name: /Office scanner/ }).click()
  await pageSave().click()

  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Scanner "Office scanner" is gone.')
  // The draft is kept so the page can save again.
  await expect.element(draftState()).toHaveTextContent('dirty')
  await expect.element(saveResult()).toHaveTextContent('failed')
})

it('tells a member who cannot manage scanners to ask an admin when no scanner exists', async () => {
  await renderSetting({ providers: [], canManageScanners: false })
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
  const { putPolicy } = await renderSetting({ readonly: true })

  await expect.element(enableSwitch()).toBeDisabled()
  await pageSave().click()
  await expect.element(draftState()).toHaveTextContent('clean')
  await expect.element(saveResult()).toHaveTextContent('unchanged')
  expect(putPolicy).not.toHaveBeenCalled()
})
