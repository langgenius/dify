import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import { vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import { QueryTestingAdapter } from './query-state-testing-adapter'

type QueryOnUrlUpdate = (event: UrlUpdateEvent) => void

type QueryTestOptions = {
  searchParams?: ComponentProps<typeof QueryTestingAdapter>['searchParams']
  onUrlUpdate?: Mock<QueryOnUrlUpdate>
}

export const createQueryTestWrapper = (options: QueryTestOptions = {}) => {
  const { searchParams = '', onUrlUpdate } = options
  const urlUpdateSpy = onUrlUpdate ?? vi.fn<QueryOnUrlUpdate>()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryTestingAdapter searchParams={searchParams} onUrlUpdate={urlUpdateSpy}>
      {children}
    </QueryTestingAdapter>
  )

  return {
    wrapper,
    onUrlUpdate: urlUpdateSpy,
  }
}

export const renderWithQueryState = (ui: ReactElement, options: QueryTestOptions = {}) => {
  const { wrapper, onUrlUpdate } = createQueryTestWrapper(options)
  const rendered = render(ui, { wrapper })
  return {
    ...rendered,
    onUrlUpdate,
  }
}
