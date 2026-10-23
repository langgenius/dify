import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCard from '../index'

const api = vi.hoisted(() => ({
  push: vi.fn(),
  bindTags: vi.fn<typeof consoleClient.tagBindings.post>(),
  checkUsage: vi.fn<typeof consoleClient.datasets.byDatasetId.useCheck.get>(),
  deleteDataset: vi.fn<typeof consoleClient.datasets.byDatasetId.delete>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'tags.get': async () => [{ id: 'tag-1', name: 'Research', type: 'knowledge' }],
      'datasets.byDatasetId.useCheck.get': api.checkUsage,
      'datasets.byDatasetId.delete': api.deleteDataset,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': api.bindTags,
    }),
  }
})

beforeEach(() => {
  api.push.mockReset()
  api.bindTags.mockReset().mockResolvedValue({ result: 'success' })
  api.checkUsage.mockReset().mockResolvedValue({ is_using: false })
  api.deleteDataset.mockReset().mockResolvedValue(undefined)
})
afterEach(() => act(() => toast.dismiss()))

function setup(
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
  workspacePermissionKeys: string[] = [],
) {
  const dataset = createDatasetFixture(overrides)
  const onSuccess = vi.fn()
  renderWithConsoleQuery(
    <>
      <AppToaster />
      <DatasetCard dataset={dataset} onSuccess={onSuccess} />
    </>,
    {
      accountProfile: { id: 'user-1' },
      workspacePermissionKeys,
      systemFeatures: { rbac_enabled: true },
    },
  )
  return { user: userEvent.setup(), dataset, onSuccess }
}

it('exposes the document entry as a named link reachable by keyboard', async () => {
  const { user, dataset } = setup()
  const link = screen.getByRole('link', { name: dataset.name })
  expect(link).toHaveAttribute('href', '/datasets/dataset-1/documents')
  await user.tab()
  expect(link).toHaveFocus()
})

it.each([
  {
    label: 'external recall',
    dataset: { provider: 'external', permission_keys: [DatasetACLPermission.RetrievalRecall] },
    destination: 'hitTesting',
  },
  {
    label: 'external settings',
    dataset: { provider: 'external', permission_keys: [] },
    destination: 'settings',
  },
  {
    label: 'unpublished pipeline',
    dataset: { runtime_mode: 'rag_pipeline', is_published: false },
    destination: 'pipeline',
  },
] satisfies {
  label: string
  dataset: Partial<DatasetDetailWithPartialMembersResponse>
  destination: string
}[])('links to $label for the corresponding dataset', ({ dataset, destination }) => {
  setup(dataset)
  expect(screen.getByRole('link', { name: 'Test Dataset' })).toHaveAttribute(
    'href',
    `/datasets/dataset-1/${destination}`,
  )
})

it('explains preview-only access while keeping tags visible and editing unavailable', async () => {
  const { user } = setup({
    name: 'Preview Only Dataset',
    permission_keys: [DatasetACLPermission.Preview],
    tags: [{ id: 'tag-1', name: 'Research', type: 'knowledge' }],
  })
  expect(screen.queryByRole('link', { name: 'Preview Only Dataset' })).not.toBeInTheDocument()
  expect(await screen.findByRole('combobox', { name: 'Research' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview Only Dataset' }))
  expect(await screen.findByText('app.noAccessResourcePermission')).toBeInTheDocument()
  expect(api.push).not.toHaveBeenCalled()
})

it.each([
  { label: 'dataset edit ACL', permissionKeys: [DatasetACLPermission.Edit], workspaceKeys: [] },
  {
    label: 'workspace tag management',
    permissionKeys: [DatasetACLPermission.Readonly],
    workspaceKeys: ['dataset.tag.manage'],
  },
])(
  'binds tags using $label without navigating to the dataset',
  async ({ permissionKeys, workspaceKeys }) => {
    const { user, onSuccess } = setup({ permission_keys: permissionKeys }, workspaceKeys)
    const trigger = screen.getByRole('combobox', { name: 'common.tag.addTag' })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Research' }))
    await user.click(trigger)
    await waitFor(() =>
      expect(api.bindTags).toHaveBeenCalledExactlyOnceWith({
        body: { tag_ids: ['tag-1'], target_id: 'dataset-1', type: 'knowledge' },
      }),
    )
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(api.push).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Test Dataset' })).not.toContainElement(trigger)
  },
)

it('withholds tag editing without either dataset edit or workspace tag management permission', async () => {
  const { user } = setup({ permission_keys: [DatasetACLPermission.Readonly] })
  const trigger = screen.getByRole('combobox', { name: 'common.tag.noTag' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(api.bindTags).not.toHaveBeenCalled()
})

it('opens access configuration from the real card menu', async () => {
  const { user } = setup({ permission_keys: [DatasetACLPermission.AccessConfig] })
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'navigation.settings.resourceAccess' }),
  )
  expect(api.push).toHaveBeenCalledExactlyOnceWith('/datasets/dataset-1/access-config')
})

it('rechecks usage after cancellation and deletes only after confirmation', async () => {
  const { user, onSuccess } = setup({ permission_keys: [DatasetACLPermission.Delete] })
  const openDelete = async () => {
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))
    return screen.findByRole('alertdialog', { name: 'dataset.deleteDatasetConfirmTitle' })
  }
  const firstDialog = await openDelete()
  expect(firstDialog).toHaveTextContent('dataset.deleteDatasetConfirmContent')
  expect(api.deleteDataset).not.toHaveBeenCalled()
  await user.click(within(firstDialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(api.deleteDataset).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()

  api.checkUsage.mockResolvedValueOnce({ is_using: true })
  const secondDialog = await openDelete()
  expect(secondDialog).toHaveTextContent('dataset.datasetUsedByApp')
  expect(api.checkUsage).toHaveBeenCalledTimes(2)
  expect(api.checkUsage).toHaveBeenLastCalledWith({ params: { dataset_id: 'dataset-1' } })
  await user.click(within(secondDialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.deleteDataset).toHaveBeenCalledExactlyOnceWith({
      params: { dataset_id: 'dataset-1' },
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(onSuccess).toHaveBeenCalledOnce()
})
