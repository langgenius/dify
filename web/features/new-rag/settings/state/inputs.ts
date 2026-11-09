import { atomWithLazy } from 'jotai/utils'

export const knowledgeSettingsSpaceIdAtom = atomWithLazy<string>(() => {
  throw new Error('Missing knowledge settings space id')
})
