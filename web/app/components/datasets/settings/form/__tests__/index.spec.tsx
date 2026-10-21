import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectLoadingButton } from '@/test/button'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import Form from '../index'

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

// Mock contexts
const mockMutateDatasets = vi.fn()

const mockUserProfile = {
  id: 'user-1',
  name: 'Current User',
  email: 'current@example.com',
  avatar_url: '',
  role: 'owner',
}
let mockWorkspacePermissionKeys = ['dataset.create_and_management']

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    userProfile: mockUserProfile,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

function render(ui: ReactElement) {
  const { wrapper } = createConsoleQueryWrapper({
    systemFeatures: { rbac_enabled: false },
  })
  return renderWithConsoleState(ui, { wrapper })
}

const createMockDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse =>
  createDatasetFixture({
    permission_keys: [DatasetACLPermission.Edit],
    ...overrides,
  })

let mockDataset: DatasetDetailWithPartialMembersResponse = createMockDataset()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: {
      dataset: DatasetDetailWithPartialMembersResponse | null
      mutateDatasetRes: () => void
    }) => unknown,
  ) => {
    const state = {
      dataset: mockDataset,
      mutateDatasetRes: mockMutateDatasets,
    }
    return selector(state)
  },
}))

// Mock services
vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
  },
}))

// Indexing controls have their own integration suite; these cases exercise the form save owner.
vi.mock('../components/indexing-section', () => ({ default: () => null }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': async () => ({ accounts: [] }),
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
    }),
  }
})

describe('Dataset settings form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createMockDataset()
    mockWorkspacePermissionKeys = ['dataset.create_and_management']
  })

  it('saves edited basic information, prevents duplicate submissions, and refreshes the dataset', async () => {
    const user = userEvent.setup()
    const { updateDatasetSetting } = await import('@/service/datasets')
    const pending = createDeferred<Awaited<ReturnType<typeof updateDatasetSetting>>>()
    vi.mocked(updateDatasetSetting).mockReturnValueOnce(pending.promise)
    render(<Form />)
    await user.clear(screen.getByDisplayValue('Test Dataset'))
    await user.type(
      screen.getByRole('textbox', { name: 'datasetSettings.form.name' }),
      'Updated Dataset',
    )
    await user.clear(screen.getByDisplayValue('Test description'))
    await user.type(screen.getByRole('textbox', { name: /form.desc/ }), 'Updated description')
    const save = screen.getByRole('button', { name: /form.save/ })
    await user.click(save)
    await waitFor(() => expectLoadingButton(save))
    await user.click(save)
    expect(updateDatasetSetting).toHaveBeenCalledTimes(1)
    expect(updateDatasetSetting).toHaveBeenCalledWith({
      datasetId: 'dataset-1',
      body: expect.objectContaining({
        name: 'Updated Dataset',
        description: 'Updated description',
      }),
    })
    expect(mockMutateDatasets).not.toHaveBeenCalled()
    await act(async () => pending.resolve(mockDataset))
    await waitFor(() => expect(mockMutateDatasets).toHaveBeenCalledTimes(1))
    expect(save).toBeEnabled()
  })

  it.each(['', '   '])(
    'shows a field error for a blank name (%j) and saves after correction',
    async (blankName) => {
      const user = userEvent.setup()
      const { updateDatasetSetting } = await import('@/service/datasets')
      render(<Form />)
      await user.clear(screen.getByDisplayValue('Test Dataset'))
      const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
      if (blankName) await user.type(name, blankName)
      await user.click(screen.getByRole('button', { name: /form.save/ }))
      expect(name).toHaveAttribute('aria-invalid', 'true')
      expect(name).toHaveAccessibleDescription('datasetSettings.form.nameError')
      expect(screen.getByRole('alert')).toHaveTextContent('datasetSettings.form.nameError')
      expect(mockToastError).not.toHaveBeenCalled()
      expect(updateDatasetSetting).not.toHaveBeenCalled()
      await user.clear(name)
      await user.type(name, 'Corrected Dataset')
      expect(name).not.toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText('datasetSettings.form.nameError')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /form.save/ }))
      await waitFor(() => expect(mockMutateDatasets).toHaveBeenCalledTimes(1))
      expect(updateDatasetSetting).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        body: expect.objectContaining({ name: 'Corrected Dataset' }),
      })
    },
  )

  it('keeps edits after a failed save and allows retrying', async () => {
    const user = userEvent.setup()
    const { updateDatasetSetting } = await import('@/service/datasets')
    vi.mocked(updateDatasetSetting).mockRejectedValueOnce(new Error('offline'))
    render(<Form />)
    await user.type(screen.getByDisplayValue('Test Dataset'), ' updated')
    await user.click(screen.getByRole('button', { name: /form.save/ }))
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully'),
    )
    expect(screen.getByDisplayValue('Test Dataset updated')).toBeInTheDocument()
    expect(mockMutateDatasets).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /form.save/ }))
    await waitFor(() => expect(mockMutateDatasets).toHaveBeenCalledTimes(1))
    expect(updateDatasetSetting).toHaveBeenCalledTimes(2)
  })

  it('disables basic information when the embedding model is unavailable', () => {
    mockDataset = createMockDataset({ embedding_available: false })
    render(<Form />)
    expect(screen.getByDisplayValue('Test Dataset')).toBeDisabled()
    expect(screen.getByDisplayValue('Test description')).toBeDisabled()
  })

  it('prevents readonly users from saving settings', async () => {
    const user = userEvent.setup()
    const { updateDatasetSetting } = await import('@/service/datasets')
    mockWorkspacePermissionKeys = []
    mockDataset = createMockDataset({ permission_keys: [DatasetACLPermission.Readonly] })
    render(<Form />)
    const save = screen.getByRole('button', { name: /form.save/ })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(updateDatasetSetting).not.toHaveBeenCalled()
  })
})
