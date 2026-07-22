import { createConsoleApiContext, expectApiResponseOK } from './console-context'

export async function deleteTestDataset(datasetId: string): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.delete(`/console/api/datasets/${datasetId}`)
    await expectApiResponseOK(response, `Delete dataset ${datasetId}`)
  } finally {
    await ctx.dispose()
  }
}
