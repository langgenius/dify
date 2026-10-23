'use client'

import { atom, useAtomValue } from 'jotai'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'

export type StudioListPath = '/apps' | '/snippets'

export const listHrefsAtom = atom<Record<string, Partial<Record<StudioListPath, string>>>>({})
const appListHrefAtom = atom(
  (get) => get(listHrefsAtom)[get(currentWorkspaceIdAtom)]?.['/apps'] ?? '/apps',
)
const snippetListHrefAtom = atom(
  (get) => get(listHrefsAtom)[get(currentWorkspaceIdAtom)]?.['/snippets'] ?? '/snippets',
)

export function useStudioListHref(path: StudioListPath) {
  return useAtomValue(path === '/apps' ? appListHrefAtom : snippetListHrefAtom)
}
