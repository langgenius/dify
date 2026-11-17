import type { ToolWithProvider } from '@/app/components/workflow/types'

export const createMcpProviderFixture = (
  overrides: Partial<ToolWithProvider> = {},
): ToolWithProvider => ({
  id: 'mcp-1',
  name: 'Existing Server',
  author: 'Dify',
  description: { en_US: 'MCP server', zh_Hans: 'MCP server' },
  label: { en_US: 'Server', zh_Hans: 'Server' },
  type: 'mcp',
  icon: { content: '🚀', background: '#FF0000' },
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: true,
  labels: [],
  tools: [],
  server_url: 'https://existing.com/mcp',
  server_identifier: 'existing-server',
  ...overrides,
})
