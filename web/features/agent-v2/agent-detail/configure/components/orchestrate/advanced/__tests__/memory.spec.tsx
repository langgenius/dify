import type {
  AgentExternalMemoryConfig,
  AgentSoulDifyToolConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { describe, expect, it } from 'vite-plus/test'
import {
  agentSoulConfigToFormState,
  formStateToAgentSoulConfig,
} from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentExternalMemorySettings } from '../memory'

const key = (name: string) => `agentV2.agentDetail.configure.memory.${name}`
const reference = (tool_name: string): AgentSoulDifyToolConfig => ({
  provider_type: 'plugin',
  plugin_id: 'example/memory',
  provider: 'memory',
  tool_name,
  credential_type: 'api-key',
  credential_ref: { type: 'provider', id: 'credential-1' },
})
const external: AgentExternalMemoryConfig = {
  prepare: reference('recall'),
  observe: reference('record'),
  subject_kind: 'user',
}

function Snapshot() {
  const draft = useAtomValue(agentComposerDraftAtom)
  return <output data-testid="memory-config">{JSON.stringify(draft.memory ?? null)}</output>
}

function setup(readOnly = false, initial: AgentExternalMemoryConfig | null = external) {
  return render(
    <AgentComposerProvider
      initialDraft={{ ...defaultAgentSoulConfigFormState, memory: { external: initial } }}
    >
      <AgentOrchestrateReadOnlyContext value={readOnly}>
        <AgentExternalMemorySettings />
        <Snapshot />
      </AgentOrchestrateReadOnlyContext>
    </AgentComposerProvider>,
  )
}

describe('external memory settings', () => {
  it('preserves complete references and unrelated memory fields through autosave', () => {
    const config = { memory: { external, scope: 'legacy-scope', artifacts: [] } }
    const draft = agentSoulConfigToFormState(config)
    expect(formStateToAgentSoulConfig({ baseConfig: config, formState: draft }).memory).toEqual(
      config.memory,
    )
    draft.memory = { ...draft.memory, external: null }
    expect(
      formStateToAgentSoulConfig({ baseConfig: config, formState: draft }).memory?.external,
    ).toBeNull()
  })

  it('disables automatic memory without deleting other agent settings', () => {
    setup()
    fireEvent.click(screen.getByRole('switch', { name: key('label') }))
    expect(screen.getByTestId('memory-config')).toHaveTextContent('"external":null')
  })

  it('edits capture policy in a local dialog and saves credential references', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await user.click(screen.getByRole('switch', { name: key('capture') }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('memory-config')).toHaveTextContent('"capture":false')
    expect(screen.getByTestId('memory-config')).toHaveTextContent('credential-1')
  })

  it('does not enable incomplete memory settings and discards cancelled edits', async () => {
    const user = userEvent.setup()
    setup(false, null)
    await user.click(screen.getByRole('switch', { name: key('label') }))
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.getByTestId('memory-config')).toHaveTextContent('"external":null')
  })

  it('prevents changes while viewing a read-only snapshot', () => {
    setup(true)
    expect(screen.getByRole('switch', { name: key('label') })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    fireEvent.click(screen.getByRole('switch', { name: key('label') }))
    expect(screen.getByTestId('memory-config')).not.toHaveTextContent('"external":null')
  })
})
