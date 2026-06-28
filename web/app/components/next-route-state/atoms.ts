import { atom } from 'jotai'

export type NextRouteParams = Record<string, string | string[]>

type NextRouteState = {
  pathname: string
  params: NextRouteParams
}

// Mirrors Next router state. NextRouteStateBridge force-hydrates this atom on
// render so feature atoms can read route state without calling router hooks.
const nextRouteStateAtom = atom<NextRouteState>({
  pathname: '',
  params: {},
})

function normalizedParamEntries(params: NextRouteParams) {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key]
      return [key, Array.isArray(value) ? [...value] : value] as const
    })
}

function normalizeNextRouteParams(params: NextRouteParams): NextRouteParams {
  return Object.fromEntries(normalizedParamEntries(params)) as NextRouteParams
}

function routeParamsKey(params: NextRouteParams) {
  return JSON.stringify(normalizedParamEntries(params))
}

export const nextParamsAtom = atom(get => get(nextRouteStateAtom).params)
export const nextPathnameAtom = atom(get => get(nextRouteStateAtom).pathname)

export const setNextRouteStateAtom = atom(null, (get, set, routeState: NextRouteState) => {
  const nextParams = normalizeNextRouteParams(routeState.params)
  const currentRouteState = get(nextRouteStateAtom)

  if (
    currentRouteState.pathname !== routeState.pathname
    || routeParamsKey(currentRouteState.params) !== routeParamsKey(nextParams)
  ) {
    set(nextRouteStateAtom, {
      pathname: routeState.pathname,
      params: nextParams,
    })
  }
})
