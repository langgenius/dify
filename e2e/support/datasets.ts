import { createApiContext, expectApiResponseOK } from './api'

export async function deleteTestDataset(datasetId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/datasets/${datasetId}`)
    await expectApiResponseOK(response, `Delete dataset ${datasetId}`)
  } finally {
    await ctx.dispose()
  }
}
