'use client'

import { atom } from 'jotai'

// A QueryClient.clear() does not discard observers cached by atomWithQuery.
export const authSessionRevisionAtom = atom(0)
