import type { AgentFileNode } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerFilesAtom = atom(
  get => get(agentComposerDraftAtom).files,
  (get, set, filesUpdate: DraftFieldUpdate<AgentFileNode[]>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      files: resolveDraftFieldUpdate(draft.files, filesUpdate),
    })
  },
)
