import type {
  AgentProviderResponse,
  AgentStrategyEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'

export const createStrategy = (
  overrides: Partial<AgentStrategyEntity> = {},
): AgentStrategyEntity => ({
  identity: {
    author: 'Dify',
    name: 'react',
    label: { en_US: 'ReAct' },
    provider: 'langgenius/agent/provider',
  },
  description: { en_US: 'Reason and use tools', zh_Hans: null },
  parameters: [
    {
      name: 'instruction',
      type: 'string',
      label: { en_US: 'Instruction' },
      default: 'Default prompt',
    },
  ],
  output_schema: null,
  features: null,
  ...overrides,
})

export const createProvider = (
  strategies: AgentStrategyEntity[] = [createStrategy()],
): AgentProviderResponse => ({
  provider: 'provider',
  plugin_id: 'langgenius/agent',
  plugin_unique_identifier: 'langgenius/agent:1.0.0@hash',
  meta: { version: null },
  declaration: {
    identity: {
      author: 'Dify',
      name: 'langgenius/agent/provider',
      icon: 'agent.svg',
      label: { en_US: 'Agent provider' },
      description: { en_US: 'Agent strategies' },
      tags: null,
    },
    plugin_id: 'langgenius/agent',
    strategies,
  },
})
