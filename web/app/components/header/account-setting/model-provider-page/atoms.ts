import { atom, useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useCallback, useMemo } from 'react'

const expandedAtom = atom<Record<string, boolean>>({})

export function useModelProviderListExpanded(providerName: string) {
  return useAtomValue(
    useMemo(
      () => selectAtom(expandedAtom, s => !!s[providerName]),
      [providerName],
    ),
  )
}

export function useSetModelProviderListExpanded(providerName: string) {
  const set = useSetAtom(expandedAtom)
  return useCallback(
    (expanded: boolean) => set(prev => ({ ...prev, [providerName]: expanded })),
    [providerName, set],
  )
}

export function useExpandModelProviderList() {
  const set = useSetAtom(expandedAtom)
  return useCallback(
    (providerName: string) => set(prev => ({ ...prev, [providerName]: true })),
    [set],
  )
}

export function useResetModelProviderListExpanded() {
  const set = useSetAtom(expandedAtom)
  return useCallback(() => set({}), [set])
}
