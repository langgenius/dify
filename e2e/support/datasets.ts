import type { PostDatasetsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { createApiContext, expectApiResponseOK } from './api'

export async function createTestDataset(name: string): Promise<PostDatasetsResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/datasets', { data: { name } })
    await expectApiResponseOK(response, `Create dataset ${name}`)
    return (await response.json()) as PostDatasetsResponse
  } finally {
    await ctx.dispose()
  }
}

export async function deleteTestDataset(datasetId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/datasets/${datasetId}`)
    await expectApiResponseOK(response, `Delete dataset ${datasetId}`)
  } finally {
    await ctx.dispose()
  }
}
