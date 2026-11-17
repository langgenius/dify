import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'

export const data = {
  name: 'Product API',
  settings: { endpoint: 'https://api.example.com', api_key: 'secret-key' },
}
export const response: ExternalKnowledgeApiResponse = {
  ...data,
  id: 'api-1',
  tenant_id: 'tenant-1',
  description: '',
  dataset_bindings: [],
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
}
