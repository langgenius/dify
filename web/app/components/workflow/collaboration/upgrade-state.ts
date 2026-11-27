import type { CollabUpgradeEntryPoint } from './analytics'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { editorCollaborationEnabledAtom, editorResourceKindAtom } from '../editor-resource/state'
import { trackCollabUpgradePrompt } from './analytics'

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

type CanvasUpgradeEntryPoint = Exclude<CollabUpgradeEntryPoint, 'tour_end'>

const openedFromAtom = atom<CanvasUpgradeEntryPoint | null>(null)

export const collaborationUpgradeOpenedAtom = atom(
  null,
  (get, set, entryPoint: CanvasUpgradeEntryPoint) => {
    set(openedFromAtom, entryPoint)
    trackCollabUpgradePrompt({
      action: 'shown',
      entry_point: entryPoint,
      workspace_id: get(currentWorkspaceIdAtom),
    })
  },
)

export const collaborationUpgradeClickedAtom = atom(null, (get) => {
  const entryPoint = get(openedFromAtom)
  if (!entryPoint) return
  trackCollabUpgradePrompt({
    action: 'upgrade_clicked',
    entry_point: entryPoint,
    workspace_id: get(currentWorkspaceIdAtom),
  })
})
