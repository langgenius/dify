import { buildChatConfig } from '../chat-config'

it('preserves workflow tool identity when adapting Agent configuration for chat', () => {
  const config = buildChatConfig({
    prompt: '',
    agentSoulConfig: {
      schema_version: 1,
      tools: {
        dify_tools: [
          {
            provider_id: 'workflow-provider',
            provider_type: 'workflow',
            tool_name: 'search',
            credential_type: 'unauthorized',
          },
        ],
      },
    },
  })

  expect(config.agent_mode).toMatchObject({
    enabled: true,
    tools: [{ provider_id: 'workflow-provider', provider_type: 'workflow', tool_name: 'search' }],
  })
})
