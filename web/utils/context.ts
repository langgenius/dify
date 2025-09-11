import { type Context, type Provider, createContext, use } from 'react'
import * as selector from 'react'

const createCreateCtxFunction = (
  useImpl: typeof use,
  createContextImpl: typeof createContext) => {
  return function<T>({ name, defaultValue }: CreateCtxOptions<T> = {}): CreateCtxReturn<T> {
    const emptySymbol = Symbol(`empty ${name}`)
    // @ts-expect-error it's ok here
    const context = createContextImpl<T>(defaultValue ?? emptySymbol)
    const useValue = () => {
      const ctx = useImpl(context)
      if (ctx === emptySymbol)
        throw new Error(`No ${name ?? 'related'} context found.`)

      return ctx
    }
    const result = [context.Provider, useValue, context] as CreateCtxReturn<T>
    result.context = context
    result.provider = context.Provider
    result.useValue = useValue
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
  useValue: () => T
}

// example
// const [AppProvider, useApp, AppContext] = createCtx<AppContextValue>()

export const createCtx = createCreateCtxFunction(use, createContext)

export const createSelectorCtx = createCreateCtxFunction(
  selector.use,
  selector.createContext as typeof createContext,
)
