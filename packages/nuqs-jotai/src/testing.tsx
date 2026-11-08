import type { ComponentProps } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { QueryStateProvider } from './index'

/** The real nuqs test adapter, with the same group registration as production. */
export function QueryTestingAdapter({
  groups,
  children,
  ...options
}: ComponentProps<typeof NuqsTestingAdapter> &
  Pick<ComponentProps<typeof QueryStateProvider>, 'groups'>) {
  return (
    <NuqsTestingAdapter {...options}>
      <QueryStateProvider groups={groups}>{children}</QueryStateProvider>
    </NuqsTestingAdapter>
  )
}
