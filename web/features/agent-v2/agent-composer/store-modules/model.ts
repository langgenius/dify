import type { DraftFieldUpdate } from './utils'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { atom, useAtom, useAtomValue } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerModelAtom = atom(
  get => get(agentComposerDraftAtom).model,
  (get, set, modelUpdate: DraftFieldUpdate<DefaultModel | undefined>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      model: resolveDraftFieldUpdate(draft.model, modelUpdate),
    })
  },
)

export function useModel() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  return [model, setModel] as const
}

export function useCurrentModel(defaultModel?: DefaultModel) {
  return useAtomValue(agentComposerModelAtom) ?? defaultModel
}
