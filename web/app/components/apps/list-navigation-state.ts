'use client'

import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'

export type StudioListPath = '/apps' | '/snippets'

const listHrefsAtom = atom<Record<string, Partial<Record<StudioListPath, string>>>>({})
const appListHrefAtom = atom(
  (get) => get(listHrefsAtom)[get(currentWorkspaceIdAtom)]?.['/apps'] ?? '/apps',
)
const snippetListHrefAtom = atom(
  (get) => get(listHrefsAtom)[get(currentWorkspaceIdAtom)]?.['/snippets'] ?? '/snippets',
)

export function useStudioListHref(path: StudioListPath) {
  return useAtomValue(path === '/apps' ? appListHrefAtom : snippetListHrefAtom)
}

export function useRememberStudioListHref(path: StudioListPath, href: string) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const setListHrefs = useSetAtom(listHrefsAtom)

  // Retain this route's destination after it unmounts; filters are always read from the URL.
  useEffect(() => {
    if (!workspaceId) return

    setListHrefs((previous) => {
      if (previous[workspaceId]?.[path] === href) return previous

      return { ...previous, [workspaceId]: { ...previous[workspaceId], [path]: href } }
    })
  }, [href, path, setListHrefs, workspaceId])
}
