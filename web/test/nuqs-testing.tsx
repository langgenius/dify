import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import type { Mock } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { vi } from 'vitest'

type NuqsSearchParams = ComponentProps<typeof NuqsTestingAdapter>['searchParams']
type NuqsOnUrlUpdate = (event: UrlUpdateEvent) => void
type NuqsOnUrlUpdateSpy = Mock<NuqsOnUrlUpdate>

type NuqsTestOptions = {
  searchParams?: NuqsSearchParams
  onUrlUpdate?: NuqsOnUrlUpdateSpy
}

type NuqsWrapperProps = {
  children: ReactNode
}

export const createNuqsTestWrapper = (options: NuqsTestOptions = {}) => {
  const { searchParams = '', onUrlUpdate } = options
  const urlUpdateSpy = onUrlUpdate ?? vi.fn<NuqsOnUrlUpdate>()
  const wrapper = ({ children }: NuqsWrapperProps) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={urlUpdateSpy}>
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

export const renderHookWithNuqs = <Result,>(callback: () => Result, options: NuqsTestOptions = {}) => {
  const { wrapper, onUrlUpdate } = createNuqsTestWrapper(options)
  const rendered = renderHook(callback, { wrapper })
  return {
    ...rendered,
    onUrlUpdate,
  }
}
