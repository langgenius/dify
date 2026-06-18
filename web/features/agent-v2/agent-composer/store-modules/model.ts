import type { DraftFieldUpdate } from './utils'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { atom } from 'jotai'
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
