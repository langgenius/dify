import type { RefObject } from 'react'
import type { PublisherEnvironment } from './types'

export function EnvironmentTabsMeasurementProbe({
  builtInLabel,
  environments,
  measurementRef,
  moreEnvironmentsLabel,
  moreLabel,
}: {
  builtInLabel: string
  environments: readonly PublisherEnvironment[]
  measurementRef: RefObject<HTMLDivElement | null>
  moreEnvironmentsLabel: string
  moreLabel: string
}) {
  return (
    <div
      ref={measurementRef}
      aria-hidden
      className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1 whitespace-nowrap"
    >
      <span data-built-in-measure className="inline-flex px-2 py-1.5 system-sm-medium">
        {builtInLabel}
      </span>
      <span
        data-more-measure
        className="inline-flex items-center gap-0.5 px-2 py-1.5 system-sm-medium"
      >
        {moreLabel}
        <span className="size-3.5" />
      </span>
      <span
        data-more-environments-measure
        className="inline-flex items-center gap-0.5 px-2 py-1.5 system-sm-medium"
      >
        {moreEnvironmentsLabel}
        <span className="size-3.5" />
      </span>
      {environments.map((environment) => (
        <span
          key={environment.id}
          data-environment-measure={environment.id}
          className="system-sm-medium"
        >
          {environment.name}
        </span>
      ))}
    </div>
  )
}
