import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DatasetDetailLayout from '@/app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/layout-main'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { AppToaster } from '@/app/notifications/app-toaster'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import datasetSettings from '@/i18n/locales/en-US/dataset-settings.json'
import fileScan from '@/i18n/locales/en-US/file-scan.json'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import Form from '../index'

const api = vi.hoisted(() => ({
  get: vi.fn<typeof consoleClient.datasets.byDatasetId.get>(),
  getScanPolicy: vi.fn(),
  save: vi.fn<typeof consoleClient.datasets.byDatasetId.patch>(),
  saveScanPolicy: vi.fn(),
}))
vi.unmock('react-i18next')
// boundary: routing is outside the settings journey; keep the real dataset layout and refetch owner.
vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/dataset-1/settings',
  useRouter: () => ({ replace: vi.fn() }),
  useParams: () => ({ datasetId: 'dataset-1' }),
}))
// boundary: replace operation responses while keeping the settings service, queries and observers real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.fileScanPolicy.get': api.getScanPolicy,
      'datasets.byDatasetId.fileScanPolicy.put': api.saveScanPolicy,
      'datasets.byDatasetId.get': api.get,
      'fileScan.providers.get': async () => ({
        data: [
          {
            id: 'scanner-1',
            name: 'Office scanner',
            provider_type: 'cloudmersive',
            config: {},
            credentials_set: { api_key: true },
            status: 'active',
            last_error: null,
            last_tested_at: null,
            created_at: 1_780_000_000,
            policy_count: 0,
          },
        ],
      }),
      'workspaces.current.members.get': async () => ({ accounts: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.byDatasetId.patch': api.save,
    }),
  }
})

const scanPolicyOff = {
  enabled: false,
  provider_id: null,
  on_unavailable: 'block',
  on_unscannable: 'block',
}

async function setup(
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
  { fileScanEnabled = false }: { fileScanEnabled?: boolean } = {},
) {
  let dataset: DatasetDetailWithPartialMembersResponse = createDatasetFixture({
    permission_keys: [DatasetACLPermission.Edit],
    ...overrides,
  })
  api.get.mockReset().mockImplementation(async () => dataset)
  api.save.mockReset().mockImplementation(async ({ body }) => {
    dataset = { ...dataset, ...body } as DatasetDetailWithPartialMembersResponse
    return dataset
  })
  api.getScanPolicy.mockReset().mockResolvedValue(scanPolicyOff)
  api.saveScanPolicy
    .mockReset()
    .mockImplementation(async ({ body }: { body: typeof scanPolicyOff }) => body)
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', name: 'Current User' },
    workspacePermissionKeys: [],
    features: { enable_file_scan: fileScanEnabled },
    systemFeatures: { rbac_enabled: false, deployment_edition: 'CLOUD' },
  })
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.datasets.retrievalSetting.get.queryKey(), {
    retrieval_method: ['semantic_search', 'full_text_search', 'hybrid_search'],
  })
  queryClient.setQueryData(emojiCatalogOptions.queryKey, [
    {
      id: 'faces',
      label: 'Faces',
      items: [{ emoji: '😎', label: 'Cool face', version: 1 }],
    },
  ])
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { app, common, datasetSettings, fileScan } },
    keySeparator: false,
  })
  const screen = await render(
    <Wrapper>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter>
          <div className="flex h-screen flex-col">
            <DatasetDetailLayout datasetId="dataset-1">
              <div className="h-full overflow-auto">
                <Form />
              </div>
            </DatasetDetailLayout>
          </div>
          <AppToaster />
        </NuqsTestingAdapter>
      </I18nextProvider>
    </Wrapper>,
  )
  await expect
    .element(screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }))
    .toHaveValue(dataset.name)
  return screen
}

it('saves edited basic information once while pending and refreshes the dataset title', async () => {
  const screen = await setup()
  const pending = createDeferred<Awaited<ReturnType<typeof api.save>>>()
  const saveResponse = api.save.getMockImplementation()!
  api.save.mockImplementationOnce(async (...args) => {
    await pending.promise
    return saveResponse(...args)
  })
  await screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }).fill('Updated Dataset')
  await screen
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Updated description')
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(api.save).toHaveBeenCalledExactlyOnceWith(
    {
      params: { dataset_id: 'dataset-1' },
      body: expect.objectContaining({
        name: 'Updated Dataset',
        description: 'Updated description',
      }),
    },
    { context: { silent: true } },
  )
  expect(document.title).toContain('Test Dataset')
  pending.resolve(createDatasetFixture())
  await expect.element(screen.getByText('Modified successfully')).toBeVisible()
  await expect.poll(() => document.title).toContain('Updated Dataset')
  await expect.element(save).not.toHaveAttribute('aria-disabled', 'true')
})

it('rejects a blank name without submitting', async () => {
  const screen = await setup()
  await screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }).fill('   ')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByText('Name cannot be empty')).toBeVisible()
  expect(api.save).not.toHaveBeenCalled()
})

it('keeps edits after a failed save and allows retrying', async () => {
  const screen = await setup()
  api.save.mockRejectedValueOnce(new Error('offline'))
  const name = screen.getByRole('textbox', { name: 'Knowledge Name', exact: true })
  await name.fill('Test Dataset updated')
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  await expect.element(screen.getByText('offline', { exact: true })).toBeVisible()
  await expect.element(name).toHaveValue('Test Dataset updated')
  expect(document.title).not.toContain('Test Dataset updated')
  await save.click()
  await expect.poll(() => document.title).toContain('Test Dataset updated')
  expect(api.save).toHaveBeenCalledTimes(2)
})

it('disables basic information and permissions when the embedding model is unavailable', async () => {
  const screen = await setup({ embedding_available: false })
  await expect
    .element(screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }))
    .toBeDisabled()
  await expect
    .element(screen.getByRole('textbox', { name: 'Description', exact: true }))
    .toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Permissions Only me' })).toBeDisabled()
})

it('prevents readonly users from editing basic information, opening the picker or saving', async () => {
  const screen = await setup({ permission_keys: [DatasetACLPermission.Readonly] })
  await expect
    .element(screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }))
    .toBeDisabled()
  await expect
    .element(screen.getByRole('textbox', { name: 'Description', exact: true }))
    .toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Permissions Only me' })).toBeDisabled()
  const icon = screen.getByRole('button', { name: 'Change knowledge icon' })
  await expect.element(icon).toBeDisabled()
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  await expect.element(save).toBeDisabled()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(api.save).not.toHaveBeenCalled()
})

it('opens the named icon action with the keyboard and returns focus after dismissal', async () => {
  const screen = await setup()
  await userEvent.tab()
  const trigger = screen.getByRole('button', { name: 'Change knowledge icon' })
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const picker = screen.getByRole('dialog', { name: 'Choose icon' })
  await expect.element(picker).toBeVisible()
  await expect.element(picker.getByRole('combobox', { name: 'Search emoji...' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(picker).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('keeps the permission field label and saves the selected visibility', async () => {
  const screen = await setup()
  await screen.getByRole('button', { name: 'Permissions Only me' }).click()
  await screen.getByRole('radio', { name: 'All team members' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Permissions All team members' }))
    .toHaveFocus()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByText('Modified successfully')).toBeVisible()
  expect(api.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.objectContaining({ permission: 'all_team_members' }) }),
    { context: { silent: true } },
  )
})

it('saves the file scan policy with the page Save button', async () => {
  const screen = await setup({}, { fileScanEnabled: true })
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  // The scan section adds no Save button of its own.
  await expect.element(save).toBeVisible()

  await screen.getByRole('switch', { name: fileScan['policy.enable'] }).click()
  await save.click()
  // Scanning cannot be turned on without a scanner: nothing is saved yet.
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent(fileScan['policy.scannerRequired'])
  expect(api.saveScanPolicy).not.toHaveBeenCalled()
  expect(api.save).not.toHaveBeenCalled()

  await screen.getByRole('combobox', { name: fileScan['policy.scanner'] }).click()
  await screen.getByRole('option', { name: /Office scanner/ }).click()
  await save.click()

  await expect.element(screen.getByText('Modified successfully')).toBeVisible()
  expect(api.saveScanPolicy.mock.calls.at(-1)?.[0]).toEqual({
    body: { ...scanPolicyOff, enabled: true, provider_id: 'scanner-1' },
    params: { dataset_id: 'dataset-1' },
  })
  expect(api.save).toHaveBeenCalledTimes(1)
})

it('does not save the other settings when the file scan policy is rejected', async () => {
  const screen = await setup({}, { fileScanEnabled: true })
  api.saveScanPolicy.mockRejectedValue(new Error('offline'))

  await screen.getByRole('switch', { name: fileScan['policy.enable'] }).click()
  await screen.getByRole('combobox', { name: fileScan['policy.scanner'] }).click()
  await screen.getByRole('option', { name: /Office scanner/ }).click()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()

  await expect.poll(() => api.saveScanPolicy.mock.calls.length).toBe(1)
  await expect
    .element(screen.getByRole('switch', { name: fileScan['policy.enable'] }))
    .toBeChecked()
  expect(api.save).not.toHaveBeenCalled()
})
