import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import { zRagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/zod.gen'

export function createDatasourceProvider(
  overrides: Partial<RagPipelineDatasourceProviderResponse> = {},
) {
  return zRagPipelineDatasourceProviderResponse.parse({
    plugin_id: 'langgenius/file',
    plugin_unique_identifier: 'langgenius/file:1.0.0',
    provider: 'file',
    is_authorized: true,
    declaration: {
      provider_type: 'local_file',
      identity: {
        author: 'Dify',
        name: 'langgenius/file/file',
        label: { en_US: 'File Source', zh_Hans: '文件源' },
        description: { en_US: 'Load files', zh_Hans: '加载文件' },
        icon: '/datasource.svg',
        tags: [],
      },
      credentials_schema: [],
      datasources: [
        {
          identity: {
            author: 'Dify',
            name: 'local-file',
            provider: 'langgenius/file/file',
            label: { en_US: 'Local File', zh_Hans: '本地文件' },
          },
          description: { en_US: 'Load local files', zh_Hans: '加载本地文件' },
          parameters: [],
          output_schema: null,
        },
      ],
    },
    ...overrides,
  })
}
