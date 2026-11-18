import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { consoleQuery } from '@/service/console'
import { editorCollaborationEnabledAtom, editorResourceKindAtom } from '../editor-resource/state'

const workspaceCollaborationUpgradeQueryAtom = atomWithQuery(() =>
  consoleQuery.features.get.queryOptions({
    select: (features) => features.workflow_collaboration_upgrade_available,
  }),
)

const collaborationUpgradeAvailableAtom = atom(
  (get) =>
    get(editorResourceKindAtom) === 'app' &&
    !get(editorCollaborationEnabledAtom) &&
    get(workspaceCollaborationUpgradeQueryAtom).data === true,
)

export const collaborationUpgradeDialogAtom = atom((get) =>
  get(collaborationUpgradeAvailableAtom) ? createDialogHandle() : null,
)
