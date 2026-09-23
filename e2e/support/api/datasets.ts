import type {
  DatasetCreatePayload,
  PostDatasetsResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ConsoleClient } from './console-client'
import { assertE2EResourceName, createE2EResourceName } from '../naming'

export async function createTestDataset(
  client: ConsoleClient,
  name = createE2EResourceName('Dataset'),
): Promise<PostDatasetsResponse> {
  assertE2EResourceName(name, 'Dataset')
  const body = {
    name,
    description: 'Disposable dataset for browser evaluation coverage.',
    indexing_technique: 'economy',
    permission: 'only_me',
    provider: 'vendor',
  } satisfies DatasetCreatePayload

  return client.datasets.post({ body })
}
