import type { AgentFileNode } from '../../agent-detail/configure/components/data'
import type { DraftFieldUpdate } from './utils'
import { atom, useAtom } from 'jotai'
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

export function useFiles() {
  const [files, setFiles] = useAtom(agentComposerFilesAtom)
  return [files, setFiles] as const
}
