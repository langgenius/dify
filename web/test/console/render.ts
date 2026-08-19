import type {
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import {
  render as testingLibraryRender,
  renderHook as testingLibraryRenderHook,
} from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createElement } from 'react'
import { seedRegisteredConsoleStateFixture } from './state-fixture'

const createConsoleStateWrapper = (
  store: ReturnType<typeof createStore>,
  Wrapper?: React.JSXElementConstructor<{ children: ReactNode }>,
) => {
  return function ConsoleStateWrapper({ children }: { children: ReactNode }) {
    const content = Wrapper ? createElement(Wrapper, undefined, children) : children
    return createElement(Provider, { store }, content)
  }
}

export const render = (ui: ReactElement, options: RenderOptions = {}): RenderResult => {
  const store = createStore()
  const hasConsoleStateFixture = seedRegisteredConsoleStateFixture(store)
  if (!hasConsoleStateFixture) return testingLibraryRender(ui, options)

  const { wrapper, ...renderOptions } = options
  const rendered = testingLibraryRender(ui, {
    ...renderOptions,
    wrapper: createConsoleStateWrapper(store, wrapper),
  })
  const rerender = rendered.rerender

  return {
    ...rendered,
    rerender: (nextUi) => {
      seedRegisteredConsoleStateFixture(store)
      rerender(nextUi)
    },
  }
}

export const renderHook = <Result, Props = void>(
  callback: (props: Props) => Result,
  options: RenderHookOptions<Props> = {},
): RenderHookResult<Result, Props> => {
  const store = createStore()
  const hasConsoleStateFixture = seedRegisteredConsoleStateFixture(store)
  if (!hasConsoleStateFixture) return testingLibraryRenderHook(callback, options)

  const { wrapper, ...renderOptions } = options
  const rendered = testingLibraryRenderHook(callback, {
    ...renderOptions,
    wrapper: createConsoleStateWrapper(store, wrapper),
  })
  const rerender = rendered.rerender

  return {
    ...rendered,
    rerender: (props) => {
      seedRegisteredConsoleStateFixture(store)
      rerender(props)
    },
  }
}
