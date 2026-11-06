import { atom } from 'jotai'

/**
 * Set by the blank creation route when it hands off to the template dialog,
 * which the Studio list it returns to opens.
 */
export const templateDialogRequestedAtom = atom(false)
