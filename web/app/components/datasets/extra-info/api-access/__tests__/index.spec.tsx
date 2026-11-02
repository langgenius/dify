import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import { DatasetACLPermission } from '@/utils/permission'
import ApiAccess from '../index'

let mockDatasetId = 'dataset-123'
let mockMutateDatasetRes = vi.fn()
let mockDatasetPermissionKeys: string[] = [DatasetACLPermission.Edit]
const mockEnableApi = vi.fn()
const mockDisableApi = vi.fn()

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      dataset: {
        id: mockDatasetId,
        permission_keys: mockDatasetPermissionKeys,
      },
      mutateDatasetRes: mockMutateDatasetRes,
    }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.apiKeys.byStatus.post': (input) =>
        ((input: { params: { status: string } }) =>
          input.params.status === 'enable' ? mockEnableApi(input) : mockDisableApi(input))(input),
    }),
  }
})

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('Dataset API access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetId = 'dataset-123'
    mockMutateDatasetRes = vi.fn()
    mockDatasetPermissionKeys = [DatasetACLPermission.Edit]
  })

  it.each([true, false])(
    'opens API details from the keyboard when sidebar expanded=%s',
    async (expand) => {
      const user = userEvent.setup()
      render(<ApiAccess expand={expand} apiEnabled />)
      const trigger = screen.getByRole('button', { name: 'common.appMenus.apiAccess' })
      await user.tab()
      expect(trigger).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(await screen.findByText('dataset.serviceApi.enabled')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'appOverview.overview.apiInfo.doc' }),
      ).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    },
  )

  it('enables the dataset API and refreshes dataset state', async () => {
    const user = userEvent.setup()
    mockEnableApi.mockResolvedValue({ result: 'success' })
    render(<ApiAccess expand apiEnabled={false} />)
    await user.click(screen.getByRole('button', { name: 'common.appMenus.apiAccess' }))

    await user.click(screen.getByRole('switch'))

    expect(mockEnableApi).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-123', status: 'enable' },
    })
    await waitFor(() => expect(mockMutateDatasetRes).toHaveBeenCalledOnce())
  })

  it('disables the dataset API and refreshes dataset state', async () => {
    const user = userEvent.setup()
    mockDisableApi.mockResolvedValue({ result: 'success' })
    render(<ApiAccess expand apiEnabled />)
    await user.click(screen.getByRole('button', { name: 'common.appMenus.apiAccess' }))

    await user.click(screen.getByRole('switch'))

    expect(mockDisableApi).toHaveBeenCalledWith({
      params: { dataset_id: 'dataset-123', status: 'disable' },
    })
    await waitFor(() => expect(mockMutateDatasetRes).toHaveBeenCalledOnce())
  })

  it('prevents API changes without dataset edit permission', async () => {
    const user = userEvent.setup()
    mockDatasetPermissionKeys = []
    render(<ApiAccess expand apiEnabled />)
    await user.click(screen.getByRole('button', { name: 'common.appMenus.apiAccess' }))

    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })
})
