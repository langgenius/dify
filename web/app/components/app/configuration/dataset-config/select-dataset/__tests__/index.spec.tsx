import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { PermissionLevel } from '@/models/permission'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import SelectDataSet from '../index'

const getDatasets = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'datasets.get': getDatasets }),
  }
})
const page = (data: DatasetDetailWithPartialMembersResponse[], page = 1, has_more = false) => ({
  data,
  page,
  limit: 20,
  total: data.length,
  has_more,
})

let mockWorkspacePermissionKeys = ['dataset.create_and_management']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: (tech: string, method: string) => `${tech}:${method}`,
  }),
}))

const baseProps = {
  isShow: true,
  onClose: vi.fn(),
  selectedIds: [] as string[],
  onSelect: vi.fn(),
}

const makeDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse>,
): DatasetDetailWithPartialMembersResponse =>
  createDatasetFixture({
    id: 'dataset-id',
    name: 'Dataset Name',
    provider: 'internal',
    icon_info: {
      icon_type: 'emoji',
      icon: '💾',
      icon_background: '#fff',
      icon_url: '',
    },
    embedding_available: true,
    is_multimodal: false,
    description: '',
    permission: PermissionLevel.allTeamMembers,
    indexing_technique: IndexingType.ECONOMICAL,
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.fullText,
      top_k: 5,
      reranking_enable: false,
      reranking_model: {
        reranking_model_name: '',
        reranking_provider_name: '',
      },
      score_threshold_enabled: false,
      score_threshold: 0,
    },
    ...overrides,
  })

describe('SelectDataSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDatasets.mockReset().mockResolvedValue(page([]))
    mockWorkspacePermissionKeys = ['dataset.create_and_management']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders dataset entries, allows selection, and fires onSelect', async () => {
    const user = userEvent.setup()
    const datasetOne = makeDataset({
      id: 'set-1',
      name: 'Dataset One',
      is_multimodal: true,
      indexing_technique: IndexingType.ECONOMICAL,
    })
    const datasetTwo = makeDataset({
      id: 'set-2',
      name: 'Hidden Dataset',
      embedding_available: false,
      provider: 'external',
    })
    getDatasets.mockResolvedValue(page([datasetOne, datasetTwo]))

    const onSelect = vi.fn()
    render(<SelectDataSet {...baseProps} onSelect={onSelect} selectedIds={[]} />)

    expect(await screen.findByText('Dataset One')).toBeInTheDocument()
    expect(screen.getByText('Hidden Dataset')).toBeInTheDocument()

    await user.click(screen.getByText('Dataset One'))
    expect(screen.getByText('1 appDebug.feature.dataSet.selected')).toBeInTheDocument()

    const addButton = screen.getByRole('button', { name: 'common.operation.add' })
    await user.click(addButton)
    expect(onSelect).toHaveBeenCalledWith([datasetOne])
  })

  it('shows empty state when no datasets are available and disables add', async () => {
    getDatasets.mockResolvedValue(page([]))

    render(<SelectDataSet {...baseProps} onSelect={vi.fn()} selectedIds={[]} />)

    expect(await screen.findByText('appDebug.feature.dataSet.noDataSet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'appDebug.feature.dataSet.toCreate' })).toHaveAttribute(
      'href',
      '/datasets/create',
    )
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
  })

  it('should hide the create dataset link when dataset.create_and_management is unavailable', async () => {
    mockWorkspacePermissionKeys = []
    getDatasets.mockResolvedValue(page([]))

    render(<SelectDataSet {...baseProps} onSelect={vi.fn()} selectedIds={[]} />)

    expect(await screen.findByText('appDebug.feature.dataSet.noDataSet')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'appDebug.feature.dataSet.toCreate' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.add' })).toBeDisabled()
  })

  it('uses selectedIds as the initial modal selection', async () => {
    const user = userEvent.setup()
    const datasetOne = makeDataset({
      id: 'set-1',
      name: 'Dataset One',
    })
    getDatasets.mockResolvedValue(page([datasetOne]))

    const onSelect = vi.fn()
    render(<SelectDataSet {...baseProps} onSelect={onSelect} selectedIds={['set-1']} />)

    await screen.findByText('Dataset One')
    expect(screen.getByText('1 appDebug.feature.dataSet.selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(onSelect).toHaveBeenCalledWith([datasetOne])
  })

  it('should deselect existing selections and ignore unavailable dataset clicks', async () => {
    const user = userEvent.setup()
    const datasetOne = makeDataset({
      id: 'set-1',
      name: 'Dataset One',
    })
    const datasetTwo = makeDataset({
      id: 'set-2',
      name: 'Unavailable Dataset',
      embedding_available: false,
    })
    const onSelect = vi.fn()
    getDatasets.mockResolvedValue(page([datasetOne, datasetTwo]))

    render(<SelectDataSet {...baseProps} onSelect={onSelect} selectedIds={['set-1']} />)

    await screen.findByText('Dataset One')
    await user.click(screen.getByText('Dataset One'))

    await waitFor(() => {
      expect(screen.queryByText('1 appDebug.feature.dataSet.selected')).not.toBeInTheDocument()
    })

    await user.click(screen.getByText('Unavailable Dataset'))
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))

    expect(onSelect).toHaveBeenCalledWith([])
  })

  it('loads another page, retains the first page and does not duplicate a pending page request', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
    const nextPage = createDeferred<ReturnType<typeof page>>()
    getDatasets
      .mockResolvedValueOnce(page([makeDataset({ id: 'set-1', name: 'First dataset' })], 1, true))
      .mockReturnValueOnce(nextPage.promise)
    render(<SelectDataSet {...baseProps} />)
    expect(await screen.findByText('First dataset')).toBeInTheDocument()
    await waitFor(() => expect(getDatasets).toHaveBeenCalledTimes(2))
    expect(getDatasets).toHaveBeenLastCalledWith({ query: { page: 2 } })
    expect(screen.getByText('First dataset')).toBeInTheDocument()
    await act(async () =>
      nextPage.resolve(page([makeDataset({ id: 'set-2', name: 'Second dataset' })], 2)),
    )
    expect(await screen.findByText('Second dataset')).toBeInTheDocument()
    expect(screen.getByText('First dataset')).toBeInTheDocument()
    expect(getDatasets).toHaveBeenCalledTimes(2)
  })

  it('does not request another page after the server reports the final page', async () => {
    getDatasets.mockResolvedValue(page([makeDataset({ id: 'set-1', name: 'Final dataset' })]))
    render(<SelectDataSet {...baseProps} />)
    await screen.findByText('Final dataset')
    expect(getDatasets).toHaveBeenCalledOnce()
  })

  it('does not request datasets while the selector is closed', async () => {
    render(<SelectDataSet {...baseProps} isShow={false} />)
    await act(async () => {})
    expect(getDatasets).not.toHaveBeenCalled()
  })
})
