import { atom } from 'jotai'

export const homeCatalogPinnedAtom = atom(false)

export const homeStickyScopedAtoms = [homeCatalogPinnedAtom]
