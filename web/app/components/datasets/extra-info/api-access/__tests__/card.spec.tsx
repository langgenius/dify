import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatasetACLPermission } from '@/utils/permission'
import Card from '../card'

let mockDatasetId = 'dataset-123'
let mockMutateDatasetRes = vi.fn()
let mockDatasetPermissionKeys: string[] = [DatasetACLPermission.Edit]
const mockEnableApi = vi.fn()
const mockDisableApi = vi.fn()

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

vi.mock('@/service/knowledge/use-dataset', () => ({
  useEnableDatasetServiceApi: () => ({ mutateAsync: mockEnableApi }),
  useDisableDatasetServiceApi: () => ({ mutateAsync: mockDisableApi }),
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('API access card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetId = 'dataset-123'
    mockMutateDatasetRes = vi.fn()
    mockDatasetPermissionKeys = [DatasetACLPermission.Edit]
  })

  it('links to the dataset API reference', () => {
    render(<Card apiEnabled />)

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://docs.dify.ai/api-reference/datasets',
    )
  })

  it('enables the dataset API and refreshes dataset state', async () => {
    const user = userEvent.setup()
    mockEnableApi.mockResolvedValue({ result: 'success' })
    render(<Card apiEnabled={false} />)

    await user.click(screen.getByRole('switch'))

    expect(mockEnableApi).toHaveBeenCalledWith('dataset-123')
    expect(mockMutateDatasetRes).toHaveBeenCalledOnce()
  })

  it('disables the dataset API and refreshes dataset state', async () => {
    const user = userEvent.setup()
    mockDisableApi.mockResolvedValue({ result: 'success' })
    render(<Card apiEnabled />)

    await user.click(screen.getByRole('switch'))

    expect(mockDisableApi).toHaveBeenCalledWith('dataset-123')
    expect(mockMutateDatasetRes).toHaveBeenCalledOnce()
  })

  it('prevents API changes without dataset edit permission', () => {
    mockDatasetPermissionKeys = []
    render(<Card apiEnabled />)

    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })
})
