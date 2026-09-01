import { atom } from 'jotai'

const pendingSaveOwnersAtom = atom<Set<string>>(new globalThis.Set<string>())

export const knowledgeSettingsScopedAtoms = [pendingSaveOwnersAtom] as const

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
