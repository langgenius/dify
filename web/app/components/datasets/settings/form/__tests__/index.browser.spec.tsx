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
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import Form from '../index'

const api = vi.hoisted(() => ({
  get: vi.fn<typeof consoleClient.datasets.byDatasetId.get>(),
  save: vi.fn<typeof consoleClient.datasets.byDatasetId.patch>(),
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
      'datasets.byDatasetId.get': api.get,
      'workspaces.current.members.get': async () => ({ accounts: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.byDatasetId.patch': api.save,
    }),
  }
})

async function setup(overrides: Partial<DatasetDetailWithPartialMembersResponse> = {}) {
  let dataset: DatasetDetailWithPartialMembersResponse = createDatasetFixture({
    permission_keys: [DatasetACLPermission.Edit],
    ...overrides,
  })
  api.get.mockReset().mockImplementation(async () => dataset)
  api.save.mockReset().mockImplementation(async ({ body }) => {
    dataset = { ...dataset, ...body } as DatasetDetailWithPartialMembersResponse
    return dataset
  })
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', name: 'Current User' },
    workspacePermissionKeys: [],
    features: {},
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
    resources: { 'en-US': { app, common, datasetSettings } },
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
