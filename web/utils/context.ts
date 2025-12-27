import type { Context, Provider } from 'react'
import { createContext, useContext } from 'react'
import * as selector from 'use-context-selector'

const createCreateCtxFunction = (
  useContextImpl: typeof useContext,
  createContextImpl: typeof createContext,
) => {
  return function<T>({ name, defaultValue }: CreateCtxOptions<T> = {}): CreateCtxReturn<T> {
    const emptySymbol = Symbol(`empty ${name}`)
    // @ts-expect-error it's ok here
    const context = createContextImpl<T>(defaultValue ?? emptySymbol)
    const useContextValue = () => {
      const ctx = useContextImpl(context)
      if (ctx === emptySymbol)
        throw new Error(`No ${name ?? 'related'} context found.`)

      return ctx
    }
    const result = [context.Provider, useContextValue, context] as CreateCtxReturn<T>
    result.context = context
    result.provider = context.Provider
    result.useContextValue = useContextValue
    return result
  }
}

type CreateCtxOptions<T> = {
  defaultValue?: T
  name?: string
}

type CreateCtxReturn<T> = [Provider<T>, () => T, Context<T>] & {
  context: Context<T>
  provider: Provider<T>
  useContextValue: () => T
}

// example
// const [AppProvider, useApp, AppContext] = createCtx<AppContextValue>()

export const createCtx = createCreateCtxFunction(useContext, createContext)

export const createSelectorCtx = createCreateCtxFunction(
  selector.useContext,
  selector.createContext as typeof createContext,
)
