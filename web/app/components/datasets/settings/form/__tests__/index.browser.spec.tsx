import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
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
import { TEST_DATASET_ID } from '@/test/console/ids'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createTestNavigation } from '@/test/next-navigation'
import { DatasetACLPermission } from '@/utils/permission'
import Form from '../index'

vi.unmock('react-i18next')

const scanPolicyOff = {
  enabled: false,
  provider_id: null,
  on_unavailable: 'block',
  on_unscannable: 'block',
}

function installDatasetApi(initial: DatasetDetailWithPartialMembersResponse) {
  let dataset = initial
  return installFakeApi({
    console: {
      datasets: {
        byDatasetId: {
          get: async () => dataset,
          patch: async ({ body }) => {
            dataset = { ...dataset, ...body } as DatasetDetailWithPartialMembersResponse
            return dataset
          },
          fileScanPolicy: {
            get: async () => scanPolicyOff,
            put: async ({ body }) => ({ ...scanPolicyOff, ...body }),
          },
        },
      },
      fileScan: {
        providers: {
          get: () => ({
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
        },
      },
      workspaces: { current: { members: { get: () => ({ accounts: [] }) } } },
    },
  })
}
let fake: ReturnType<typeof installDatasetApi>

async function setup(
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
  {
    fileScanEnabled = false,
    beforeRender,
  }: { fileScanEnabled?: boolean; beforeRender?: () => void } = {},
) {
  const dataset = createDatasetFixture({
    id: TEST_DATASET_ID,
    permission_keys: [DatasetACLPermission.Edit],
    ...overrides,
  })
  fake = installDatasetApi(dataset)
  onTestFinished(fake)
  beforeRender?.()
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
            <DatasetDetailLayout datasetId={TEST_DATASET_ID}>
              <div className="h-full overflow-auto">
                <Form />
              </div>
            </DatasetDetailLayout>
          </div>
          <AppToaster />
        </NuqsTestingAdapter>
      </I18nextProvider>
    </Wrapper>,
    {
      wrapper: createTestNavigation({
        url: `/datasets/${TEST_DATASET_ID}/settings`,
        params: { datasetId: TEST_DATASET_ID },
      }).NavigationProvider,
    },
  )
  await expect
    .element(screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }))
    .toHaveValue(dataset.name)
  return screen
}

it('saves edited basic information once while pending and refreshes the dataset title', async () => {
  const screen = await setup()
  const pending = hold(fake.console.datasets.byDatasetId.patch)
  await screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }).fill('Updated Dataset')
  await screen
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Updated description')
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => fake.console.datasets.byDatasetId.patch).toHaveBeenCalledOnce()
  expect(fake.console.datasets.byDatasetId.patch).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { dataset_id: TEST_DATASET_ID },
      body: expect.objectContaining({
        name: 'Updated Dataset',
        description: 'Updated description',
      }),
    }),
  )
  expect(document.title).toContain('Test Dataset')
  pending.release()
  await expect.element(screen.getByText('Modified successfully')).toBeVisible()
  await expect.poll(() => document.title).toContain('Updated Dataset')
  await expect.element(save).not.toHaveAttribute('aria-disabled', 'true')
})

it('shows a failed member list load above the form and retries it', async () => {
  let restoreMembers = () => {}
  const screen = await setup(
    {},
    {
      beforeRender: () => {
        const members = fake.console.workspaces.current.members.get
        const loadMembers = members.getMockImplementation()!
        members.mockRejectedValue(apiError({ status: 503, message: 'Members unavailable' }))
        restoreMembers = () => members.mockImplementation(loadMembers)
      },
    },
  )

  const alert = screen.getByRole('alert')
  await expect.element(alert).toBeVisible()
  restoreMembers()
  await alert.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})

it('rejects a blank name without submitting', async () => {
  const screen = await setup()
  await screen.getByRole('textbox', { name: 'Knowledge Name', exact: true }).fill('   ')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByText('Name cannot be empty')).toBeVisible()
  expect(fake.console.datasets.byDatasetId.patch).not.toHaveBeenCalled()
})

it('keeps edits after a failed save and allows retrying', async () => {
  const screen = await setup()
  fake.console.datasets.byDatasetId.patch.mockRejectedValueOnce(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'offline' }),
  )
  const name = screen.getByRole('textbox', { name: 'Knowledge Name', exact: true })
  await name.fill('Test Dataset updated')
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  await expect.element(screen.getByText('offline', { exact: true })).toBeVisible()
  await expect.element(name).toHaveValue('Test Dataset updated')
  expect(document.title).not.toContain('Test Dataset updated')
  await save.click()
  await expect.poll(() => document.title).toContain('Test Dataset updated')
  expect(fake.console.datasets.byDatasetId.patch).toHaveBeenCalledTimes(2)
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
  expect(fake.console.datasets.byDatasetId.patch).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.objectContaining({ permission: 'all_team_members' }) }),
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
  expect(fake.console.datasets.byDatasetId.fileScanPolicy.put).not.toHaveBeenCalled()
  expect(fake.console.datasets.byDatasetId.patch).not.toHaveBeenCalled()

  await screen.getByRole('combobox', { name: fileScan['policy.scanner'] }).click()
  await screen.getByRole('option', { name: /Office scanner/ }).click()
  await save.click()

  await expect.element(screen.getByText('Modified successfully')).toBeVisible()
  expect(fake.console.datasets.byDatasetId.fileScanPolicy.put.mock.calls.at(-1)?.[0]).toMatchObject(
    {
      body: { ...scanPolicyOff, enabled: true, provider_id: 'scanner-1' },
      params: { dataset_id: TEST_DATASET_ID },
    },
  )
  expect(fake.console.datasets.byDatasetId.patch).toHaveBeenCalledTimes(1)
})

it('does not save the other settings when the file scan policy is rejected', async () => {
  const screen = await setup({}, { fileScanEnabled: true })
  fake.console.datasets.byDatasetId.fileScanPolicy.put.mockRejectedValue(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'offline' }),
  )

  await screen.getByRole('switch', { name: fileScan['policy.enable'] }).click()
  await screen.getByRole('combobox', { name: fileScan['policy.scanner'] }).click()
  await screen.getByRole('option', { name: /Office scanner/ }).click()
  await screen.getByRole('button', { name: 'Save', exact: true }).click()

  await expect
    .poll(() => fake.console.datasets.byDatasetId.fileScanPolicy.put.mock.calls.length)
    .toBe(1)
  await expect
    .element(screen.getByRole('dialog', { name: fileScan['policy.saveFailed'] }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('switch', { name: fileScan['policy.enable'] }))
    .toBeChecked()
  expect(fake.console.datasets.byDatasetId.patch).not.toHaveBeenCalled()
})
