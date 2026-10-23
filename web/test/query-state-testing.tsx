import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ComponentProps, ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import { vi } from 'vite-plus/test'
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
