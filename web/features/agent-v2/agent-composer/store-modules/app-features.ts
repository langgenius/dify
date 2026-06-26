import type { AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { DraftFieldUpdate } from './utils'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerAppFeaturesAtom = atom(
  get => get(agentComposerDraftAtom).appFeatures,
  (get, set, appFeaturesUpdate: DraftFieldUpdate<AgentSoulAppFeaturesConfig | undefined>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      appFeatures: resolveDraftFieldUpdate(draft.appFeatures, appFeaturesUpdate),
    })
  },
)

export function useAppFeatures() {
  return useAtomValue(agentComposerAppFeaturesAtom)
}

export function useSetAppFeatures() {
  return useSetAtom(agentComposerAppFeaturesAtom)
}
