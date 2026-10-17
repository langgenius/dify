import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { vi } from 'vite-plus/test'
import { render, renderHook } from '@/test/console/render'

type NuqsSearchParams = ComponentProps<typeof NuqsTestingAdapter>['searchParams']
type NuqsOnUrlUpdate = (event: UrlUpdateEvent) => void
type NuqsOnUrlUpdateSpy = Mock<NuqsOnUrlUpdate>

type NuqsTestOptions = {
  searchParams?: NuqsSearchParams
  onUrlUpdate?: NuqsOnUrlUpdateSpy
  hasMemory?: boolean
}

type NuqsHookTestOptions<Props> = NuqsTestOptions & {
  initialProps?: Props
}

type NuqsWrapperProps = {
  children: ReactNode
}

export const createNuqsTestWrapper = (options: NuqsTestOptions = {}) => {
  const { searchParams = '', onUrlUpdate, hasMemory } = options
  const urlUpdateSpy = onUrlUpdate ?? vi.fn<NuqsOnUrlUpdate>()
  const wrapper = ({ children }: NuqsWrapperProps) => (
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={urlUpdateSpy}
      hasMemory={hasMemory}
    >
      {children}
    </NuqsTestingAdapter>
  )

  return {
    wrapper,
    onUrlUpdate: urlUpdateSpy,
  }
}

export const renderWithNuqs = (ui: ReactElement, options: NuqsTestOptions = {}) => {
  const { wrapper, onUrlUpdate } = createNuqsTestWrapper(options)
  const rendered = render(ui, { wrapper })
  return {
    ...rendered,
    onUrlUpdate,
  }
}

export const renderHookWithNuqs = <Result, Props = void>(
  callback: (props: Props) => Result,
  options: NuqsHookTestOptions<Props> = {},
) => {
  const { initialProps, ...nuqsOptions } = options
  const { wrapper, onUrlUpdate } = createNuqsTestWrapper(nuqsOptions)
  const rendered = renderHook(callback, { wrapper, initialProps })
  return {
    ...rendered,
    onUrlUpdate,
  }
}

/** Compose URL state with a suite's existing Query or application providers. */
export const createNuqsTestRenderer = <
  Options extends unknown[],
  Result extends { rerender: (ui: ReactElement) => void },
>(
  renderOwner: (ui: ReactElement, ...options: Options) => Result,
  getOptions: () => NuqsTestOptions = () => ({}),
) => {
  return (ui: ReactNode, ...options: Options): Result => {
    const { wrapper: UrlState } = createNuqsTestWrapper(getOptions())
    const wrap = (element: ReactNode) => <UrlState>{element}</UrlState>
    const rendered = renderOwner(wrap(ui), ...options)
    return { ...rendered, rerender: (element) => rendered.rerender(wrap(element)) }
  }
}
