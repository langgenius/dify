import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { editorCollaborationEnabledAtom, editorResourceKindAtom } from '../editor-resource/state'

const workspacePlanQueryAtom = atomWithQuery(() =>
  consoleQuery.features.get.queryOptions({
    select: (features) => features.billing.subscription.plan,
  }),
)

export const collaborationUpgradeAvailableAtom = atom(
  (get) =>
    get(editorResourceKindAtom) === 'app' &&
    !get(editorCollaborationEnabledAtom) &&
    get(deploymentEditionAtom) === 'CLOUD' &&
    get(workspacePlanQueryAtom).data === 'sandbox',
)
