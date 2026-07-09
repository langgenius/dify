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

const removeAgentFileNode = (files: AgentFileNode[], fileId: string): AgentFileNode[] => files.flatMap((file) => {
  if (file.id === fileId)
    return []

  if (file.children)
    return [{ ...file, children: removeAgentFileNode(file.children, fileId) }]

  return [file]
})

export const upsertAgentFileAtom = atom(null, (_get, set, file: AgentFileNode) => {
  set(agentComposerFilesAtom, files => [
    ...removeAgentFileNode(files, file.id),
    file,
  ])
})

export const removeAgentFileAtom = atom(null, (_get, set, fileId: string) => {
  set(agentComposerFilesAtom, files => removeAgentFileNode(files, fileId))
})

export const clearAgentConfigNoteAtom = atom(null, (get, set) => {
  const draft = get(agentComposerDraftAtom)

  set(agentComposerDraftAtom, {
    ...draft,
    configNote: '',
  })
})
