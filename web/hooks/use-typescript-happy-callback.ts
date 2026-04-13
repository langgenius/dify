import { useCallback as useCallbackFromReact } from 'react'

/** @see https://foxact.skk.moe/use-typescript-happy-callback */
const useTypeScriptHappyCallback: <Args extends unknown[], R>(
  fn: (...args: Args) => R,
  deps: React.DependencyList,
) => (...args: Args) => R = useCallbackFromReact

/** @see https://foxact.skk.moe/use-typescript-happy-callback */
export const useCallback = useTypeScriptHappyCallback
