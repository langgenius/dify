import type { ToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'

export const createToolProviderFixture = (
  overrides: Partial<ToolProviderApiEntityResponse> = {},
): ToolProviderApiEntityResponse => ({
  id: 'provider-1',
  name: 'provider',
  type: 'builtin',
  author: 'Dify',
  label: { en_US: 'Provider' },
  description: { en_US: 'Tool provider' },
  icon: '/provider.svg',
  tools: [],
  ...overrides,
})
