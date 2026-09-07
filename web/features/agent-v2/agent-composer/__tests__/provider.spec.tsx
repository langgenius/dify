import { render, screen } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { describe, expect, it } from 'vite-plus/test'
import { defaultAgentSoulConfigFormState } from '../form-state'
import { AgentComposerProvider } from '../provider'
import {
  agentComposerDraftAtom,
  agentComposerSavedDraftAtom,
  isAgentComposerDirtyAtom,
} from '../store'

function StoreSnapshot() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const savedDraft = useAtomValue(agentComposerSavedDraftAtom)
  const isDirty = useAtomValue(isAgentComposerDirtyAtom)

  return (
    <dl>
      <dt>draft</dt>
      <dd>{draft.prompt}</dd>
      <dt>saved draft</dt>
      <dd>{savedDraft?.prompt}</dd>
      <dt>dirty</dt>
      <dd>{String(isDirty)}</dd>
    </dl>
  )
}

function getDefinition(term: string) {
  return screen.getByText(term, { selector: 'dt' }).nextElementSibling
}

describe('AgentComposerProvider', () => {
  it('initializes draft baselines when creating the scoped store', () => {
    const initialDraft = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Be precise.',
    }
    render(
      <AgentComposerProvider initialDraft={initialDraft}>
        <StoreSnapshot />
      </AgentComposerProvider>,
    )

    expect(getDefinition('draft')).toHaveTextContent('Be precise.')
    expect(getDefinition('saved draft')).toHaveTextContent('Be precise.')
    expect(getDefinition('dirty')).toHaveTextContent('false')
  })

  it('creates a new scoped store when the composer session key changes', () => {
    const firstDraft = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Agent one draft',
    }
    const secondDraft = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Agent two draft',
    }
    const { rerender } = render(
      <AgentComposerProvider key="agent-1:draft" initialDraft={firstDraft}>
        <StoreSnapshot />
      </AgentComposerProvider>,
    )

    expect(getDefinition('draft')).toHaveTextContent('Agent one draft')

    rerender(
      <AgentComposerProvider key="agent-2:draft" initialDraft={secondDraft}>
        <StoreSnapshot />
      </AgentComposerProvider>,
    )

    expect(getDefinition('draft')).toHaveTextContent('Agent two draft')
    expect(getDefinition('saved draft')).toHaveTextContent('Agent two draft')
  })
})
