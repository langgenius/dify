import type { ComponentProps } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { QueryStateProvider } from './index'

/** The real nuqs test adapter, with the same atom registration as production. */
export function QueryTestingAdapter({
  atoms,
  children,
  ...options
}: ComponentProps<typeof NuqsTestingAdapter> &
  Pick<ComponentProps<typeof QueryStateProvider>, 'atoms'>) {
  return (
    <NuqsTestingAdapter {...options}>
      <QueryStateProvider atoms={atoms}>{children}</QueryStateProvider>
    </NuqsTestingAdapter>
  )
}
