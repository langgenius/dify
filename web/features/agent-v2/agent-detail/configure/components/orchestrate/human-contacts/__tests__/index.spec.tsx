import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { describe, expect, it, vi } from 'vite-plus/test'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentHumanContacts } from '../index'

const mocks = vi.hoisted(() => ({
  accounts: [
    {
      id: 'member-1',
      name: 'Alice',
      email: 'alice@example.com',
      avatar: '',
      avatar_url: null,
      status: 'active',
      role: 'editor',
      roles: [],
    },
  ],
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({ data: { accounts: mocks.accounts } }),
}))

function DraftProbe() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const config = formStateToAgentSoulConfig({ formState: draft })
  return (
    <>
      <output aria-label="prompt">{draft.prompt}</output>
      <output aria-label="human contacts">{JSON.stringify(config.human?.contacts ?? [])}</output>
    </>
  )
}

const humanDraft: AgentSoulConfigFormState = {
  ...defaultAgentSoulConfigFormState,
  prompt: 'Escalate to [§human:member-1:Alice§]',
  humanContacts: [
    {
      id: 'member-1',
      name: 'Alice',
      email: 'alice@example.com',
      channel: 'email',
    },
  ],
}

function renderHumanContacts({
  initialDraft = humanDraft,
  readOnly = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  readOnly?: boolean
} = {}) {
  return render(
    <AgentComposerProvider initialDraft={initialDraft}>
      <AgentOrchestrateReadOnlyContext value={readOnly}>
        <AgentHumanContacts />
        <DraftProbe />
      </AgentOrchestrateReadOnlyContext>
    </AgentComposerProvider>,
  )
}

const removeHumanLabel = 'agentV2.agentDetail.configure.humanContacts.remove'

describe('AgentHumanContacts', () => {
  it('shows contacts already referenced by the Prompt and persists them', () => {
    renderHumanContacts()

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText('human contacts')).toHaveTextContent('member-1')
    expect(screen.getByLabelText('prompt')).toHaveTextContent('[§human:member-1:Alice§]')
  })

  it('removes the configured contact and all of its prompt mentions together', () => {
    renderHumanContacts()
    fireEvent.click(screen.getByRole('button', { name: removeHumanLabel }))

    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
    expect(screen.getByLabelText('human contacts')).toHaveTextContent('[]')
    expect(screen.getByLabelText('prompt')).not.toHaveTextContent('[§human:member-1:Alice§]')
  })

  it('does not expose contact removal in read-only mode', () => {
    renderHumanContacts({ readOnly: true })
    expect(screen.queryByRole('button', { name: removeHumanLabel })).not.toBeInTheDocument()
  })

  it('shows the empty state without exposing a second add flow', () => {
    renderHumanContacts({ initialDraft: defaultAgentSoulConfigFormState })
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
