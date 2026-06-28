import type { AgentFileNode } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { syncFileReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerFilesAtom = atom<AgentFileNode[], [DraftFieldUpdate<AgentFileNode[]>], void>(
  get => get(agentComposerDraftAtom).files,
  (get, set, filesUpdate: DraftFieldUpdate<AgentFileNode[]>) => {
    const draft = get(agentComposerDraftAtom)
    const files = resolveDraftFieldUpdate(draft.files, filesUpdate)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncFileReferenceLabels({
        prompt: draft.prompt,
        currentFiles: draft.files,
        nextFiles: files,
      }),
      files,
    })
  },
)
