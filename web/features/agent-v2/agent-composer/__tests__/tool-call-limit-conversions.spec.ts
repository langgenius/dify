import type { AgentSoulConfigFormState } from '../form-state'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '../conversions'
import { defaultAgentSoulConfigFormState } from '../form-state'

it('round trips operation limits alongside credentials and parameters when another setting changes', () => {
  const formState: AgentSoulConfigFormState = {
    ...defaultAgentSoulConfigFormState,
    tools: [
      {
        id: 'github',
        name: 'GitHub',
        kind: 'provider',
        providerType: 'api',
        iconClassName: '',
        credentialVariant: 'authorized',
        credentialId: 'credential',
        actions: [
          { id: 'search', name: 'search', toolName: 'search', description: '', maxCallsPerRun: 3 },
          { id: 'issues', name: 'issues', toolName: 'issues', description: '' },
        ],
      },
    ],
    toolSettings: { search: { query: 'dify' } },
  }
  const saved = formStateToAgentSoulConfig({ formState })
  expect(saved.tools?.dify_tools?.[0]).toMatchObject({
    tool_name: 'search',
    max_calls_per_run: 3,
    credential_ref: { id: 'credential' },
    runtime_parameters: { query: 'dify' },
  })
  expect(saved.tools?.dify_tools?.[1]?.max_calls_per_run).toBeNull()
  const reloaded = agentSoulConfigToFormState(saved)
  const next = formStateToAgentSoulConfig({ formState: { ...reloaded, prompt: 'Updated prompt' } })
  expect(next.tools).toEqual(saved.tools)
})
