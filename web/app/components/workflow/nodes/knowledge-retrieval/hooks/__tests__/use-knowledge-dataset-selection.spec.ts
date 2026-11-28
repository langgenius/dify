import type { KnowledgeRetrievalNodeType } from '../../types'
import { renderHook, waitFor } from '@testing-library/react'
import { reportRequestError } from '@/app/query-error-toast'
import { fetchDatasets } from '@/service/datasets'
import { createHttpError } from '@/service/http-error'
import { RETRIEVE_TYPE } from '@/types/app'
import useKnowledgeDatasetSelection from '../use-knowledge-dataset-selection'

vi.mock('@/service/datasets', () => ({ fetchDatasets: vi.fn() }))
vi.mock('@/app/query-error-toast', () => ({ reportRequestError: vi.fn() }))

const renderSelection = (datasetIds: string[]) => {
  const inputs = { dataset_ids: datasetIds } as KnowledgeRetrievalNodeType
  return renderHook(() =>
    useKnowledgeDatasetSelection({
      inputs,
      inputRef: { current: inputs },
      setInputs: vi.fn(),
      payloadRetrievalMode: RETRIEVE_TYPE.multiWay,
      updateDatasetsDetail: vi.fn(),
      fallbackRerankModel: {},
    }),
  )
}

describe('useKnowledgeDatasetSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the selection loaded after the lookup succeeds', async () => {
    vi.mocked(fetchDatasets).mockResolvedValueOnce({ data: [] } as never)

    const { result } = renderSelection(['dataset-1'])

    await waitFor(() => expect(result.current.selectedDatasetsLoaded).toBe(true))
  })

  it('marks an empty selection loaded without a lookup', async () => {
    const { result } = renderSelection([])

    await waitFor(() => expect(result.current.selectedDatasetsLoaded).toBe(true))
    expect(fetchDatasets).not.toHaveBeenCalled()
  })

  // Metadata cleanup trusts the loaded flag, so a failed lookup must not remove saved conditions.
  it('reports a failed lookup without marking the selection loaded', async () => {
    const error = createHttpError({ status: 503, statusText: '', headers: new Headers() }, {})
    vi.mocked(fetchDatasets).mockRejectedValueOnce(error)

    const { result } = renderSelection(['dataset-1'])

    await waitFor(() => expect(reportRequestError).toHaveBeenCalledWith(error))
    expect(result.current.selectedDatasetsLoaded).toBe(false)
  })
})
