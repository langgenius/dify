import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type Props = {
  className?: string
}

// OpenTelemetry wordmark from packages/iconify-collections/assets/public/tracing, served as
// i-custom-* classes. The sprite is 2.67:1, so width is fixed per size instead of the plugin's 1rem square.
export const OtelIcon: FC<Props> = ({ className }) => (
  <span
    aria-hidden
    className={cn('i-custom-public-tracing-otel-icon h-4 w-[2.67rem] shrink-0', className)}
  />
)

export const OtelIconBig: FC<Props> = ({ className }) => (
  <span
    aria-hidden
    className={cn('i-custom-public-tracing-otel-icon-big h-6 w-16 shrink-0', className)}
  />
)
