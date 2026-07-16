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
      <dd data-testid="draft-prompt">{draft.prompt}</dd>
      <dt>original draft</dt>
      <dd data-testid="original-draft-prompt">{originalDraft?.prompt}</dd>
      <dt>published draft</dt>
      <dd data-testid="published-draft-prompt">{publishedDraft?.prompt}</dd>
      <dt>original config</dt>
      <dd data-testid="original-config-prompt">{originalConfig?.prompt?.system_prompt}</dd>
      <dt>dirty</dt>
      <dd data-testid="dirty">{String(isDirty)}</dd>
      <dt>unpublished</dt>
      <dd data-testid="unpublished">{String(hasUnpublishedChanges)}</dd>
    </dl>
  )
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

    expect(screen.getByTestId('draft-prompt')).toHaveTextContent('Be precise.')
    expect(screen.getByTestId('original-draft-prompt')).toHaveTextContent('Be precise.')
    expect(screen.getByTestId('published-draft-prompt')).toHaveTextContent('Be precise.')
    expect(screen.getByTestId('original-config-prompt')).toHaveTextContent('Be precise.')
    expect(screen.getByTestId('dirty')).toHaveTextContent('false')
    expect(screen.getByTestId('unpublished')).toHaveTextContent('false')
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

    expect(screen.getByTestId('draft-prompt')).toHaveTextContent('Agent one draft')

    rerender(
      <AgentComposerProvider key="agent-2:draft" initialDraft={secondDraft}>
        <StoreSnapshot />
      </AgentComposerProvider>,
    )

    expect(screen.getByTestId('draft-prompt')).toHaveTextContent('Agent two draft')
    expect(screen.getByTestId('original-draft-prompt')).toHaveTextContent('Agent two draft')
    expect(screen.getByTestId('published-draft-prompt')).toHaveTextContent('Agent two draft')
  })
})
