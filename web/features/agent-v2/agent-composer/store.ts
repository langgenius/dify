import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentSoulConfigFormState } from './form-state'
import isEqual from 'fast-deep-equal'
import { atom } from 'jotai'
import { defaultAgentSoulConfigFormState } from './form-state'

export const agentComposerOriginalConfigAtom = atom<AgentSoulConfig | undefined>(undefined)
export const agentComposerOriginalDraftAtom = atom<AgentSoulConfigFormState | undefined>(defaultAgentSoulConfigFormState)
export const agentComposerPublishedDraftAtom = atom<AgentSoulConfigFormState | undefined>(defaultAgentSoulConfigFormState)
export const agentComposerDraftAtom = atom<AgentSoulConfigFormState>(defaultAgentSoulConfigFormState)

export const isAgentComposerDirtyAtom = atom((get) => {
  const originalDraft = get(agentComposerOriginalDraftAtom)
  const draft = get(agentComposerDraftAtom)

  return !isEqual(draft, originalDraft ?? defaultAgentSoulConfigFormState)
})

export const hasAgentComposerUnpublishedChangesAtom = atom((get) => {
  const publishedDraft = get(agentComposerPublishedDraftAtom)
  const draft = get(agentComposerDraftAtom)

  return !isEqual(draft, publishedDraft ?? defaultAgentSoulConfigFormState)
})
