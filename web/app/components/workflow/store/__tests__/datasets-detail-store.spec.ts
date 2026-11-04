import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { createDatasetsDetailStore } from '../../datasets-detail-store/store'

function makeDataset(id: string, name: string): DatasetDetailWithPartialMembersResponse {
  return { id, name } as DatasetDetailWithPartialMembersResponse
}

describe('DatasetsDetailStore', () => {
  it('refreshes matching datasets while preserving cached entries omitted from the response', () => {
    const store = createDatasetsDetailStore()
    const cached = makeDataset('cached', 'Cached dataset')
    const original = makeDataset('updated', 'Original name')
    const updated = makeDataset('updated', 'Updated name')
    const added = makeDataset('added', 'Added dataset')

    store.getState().updateDatasetsDetail([cached, original])
    store.getState().updateDatasetsDetail([updated, added])
    store.getState().updateDatasetsDetail([])

    expect(store.getState().datasetsDetail).toEqual({ cached, updated, added })
  })
})
