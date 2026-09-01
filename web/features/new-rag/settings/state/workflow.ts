import { atom } from 'jotai'

const basicDraftActiveAtom = atom(false)
const retrievalDraftActiveAtom = atom(false)
const pendingSaveOwnersAtom = atom<Set<string>>(new globalThis.Set<string>())

export const knowledgeSettingsScopedAtoms = [
  basicDraftActiveAtom,
  retrievalDraftActiveAtom,
  pendingSaveOwnersAtom,
] as const

export const knowledgeSettingsHasUnsavedWorkAtom = atom(
  (get) => get(basicDraftActiveAtom) || get(retrievalDraftActiveAtom),
)

export const knowledgeSettingsHasPendingSaveAtom = atom(
  (get) => get(pendingSaveOwnersAtom).size > 0,
)

export const setKnowledgeSettingsSavePendingAtom = atom(
  null,
  (_get, set, { owner, pending }: { owner: string; pending: boolean }) => {
    set(pendingSaveOwnersAtom, (current) => {
      const owners = new globalThis.Set(current)
      if (pending) owners.add(owner)
      else owners.delete(owner)
      return owners
    })
  },
)

export const startKnowledgeSettingsBasicDraftAtom = atom(null, (_get, set) => {
  set(basicDraftActiveAtom, true)
})

export const finishKnowledgeSettingsBasicDraftAtom = atom(null, (_get, set) => {
  set(basicDraftActiveAtom, false)
})

export const startKnowledgeSettingsRetrievalDraftAtom = atom(null, (_get, set) => {
  set(retrievalDraftActiveAtom, true)
})

export const finishKnowledgeSettingsRetrievalDraftAtom = atom(null, (_get, set) => {
  set(retrievalDraftActiveAtom, false)
})
