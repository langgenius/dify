import { atom, useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useCallback, useMemo } from 'react'

const modelProviderListExpandedAtom = atom<Record<string, boolean>>({})

const setModelProviderListExpandedAtom = atom(
  null,
  (get, set, params: { providerName: string, expanded: boolean }) => {
    const { providerName, expanded } = params
    const current = get(modelProviderListExpandedAtom)

    if (expanded) {
      if (current[providerName])
        return

      set(modelProviderListExpandedAtom, {
        ...current,
        [providerName]: true,
      })
      return
    }

    if (!current[providerName])
      return

    const next = { ...current }
    delete next[providerName]
    set(modelProviderListExpandedAtom, next)
  },
)

const resetModelProviderListExpandedAtom = atom(
  null,
  (_get, set) => {
    set(modelProviderListExpandedAtom, {})
  },
)

export function useModelProviderListExpanded(providerName: string) {
  const selectedAtom = useMemo(
    () => selectAtom(modelProviderListExpandedAtom, state => state[providerName] ?? false),
    [providerName],
  )
  return useAtomValue(selectedAtom)
}

export function useSetModelProviderListExpanded(providerName: string) {
  const setExpanded = useSetAtom(setModelProviderListExpandedAtom)
  return useCallback((expanded: boolean) => {
    setExpanded({ providerName, expanded })
  }, [providerName, setExpanded])
}

export function useExpandModelProviderList() {
  const setExpanded = useSetAtom(setModelProviderListExpandedAtom)
  return useCallback((providerName: string) => {
    setExpanded({ providerName, expanded: true })
  }, [setExpanded])
}

export function useResetModelProviderListExpanded() {
  return useSetAtom(resetModelProviderListExpandedAtom)
}
