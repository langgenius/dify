import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { render, screen } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { describe, expect, it } from 'vitest'
import { defaultAgentSoulConfigFormState } from '../form-state'
import { AgentComposerProvider } from '../provider'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
  hasAgentComposerUnpublishedChangesAtom,
  isAgentComposerDirtyAtom,
} from '../store'

function StoreSnapshot() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const originalDraft = useAtomValue(agentComposerOriginalDraftAtom)
  const publishedDraft = useAtomValue(agentComposerPublishedDraftAtom)
  const originalConfig = useAtomValue(agentComposerOriginalConfigAtom)
  const isDirty = useAtomValue(isAgentComposerDirtyAtom)
  const hasUnpublishedChanges = useAtomValue(hasAgentComposerUnpublishedChangesAtom)

  return (
    <dl>
      <dt>draft</dt>
      <dd>{draft.prompt}</dd>
      <dt>original draft</dt>
      <dd>{originalDraft?.prompt}</dd>
      <dt>published draft</dt>
      <dd>{publishedDraft?.prompt}</dd>
      <dt>original config</dt>
      <dd>{originalConfig?.prompt?.system_prompt}</dd>
      <dt>dirty</dt>
      <dd>{String(isDirty)}</dd>
      <dt>unpublished</dt>
      <dd>{String(hasUnpublishedChanges)}</dd>
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
    const initialOriginalConfig = {
      prompt: {
        system_prompt: 'Be precise.',
      },
    } satisfies AgentSoulConfig

    render(
      <AgentComposerProvider
        initialDraft={initialDraft}
        initialOriginalConfig={initialOriginalConfig}
      >
        <StoreSnapshot />
      </AgentComposerProvider>,
    )

    expect(getDefinition('draft')).toHaveTextContent('Be precise.')
    expect(getDefinition('original draft')).toHaveTextContent('Be precise.')
    expect(getDefinition('published draft')).toHaveTextContent('Be precise.')
    expect(getDefinition('original config')).toHaveTextContent('Be precise.')
    expect(getDefinition('dirty')).toHaveTextContent('false')
    expect(getDefinition('unpublished')).toHaveTextContent('false')
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
    expect(getDefinition('original draft')).toHaveTextContent('Agent two draft')
    expect(getDefinition('published draft')).toHaveTextContent('Agent two draft')
  })
})
