import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type Props = {
  className?: string
}

// OpenTelemetry mark from packages/iconify-collections/assets/public/tracing, served as
// i-custom-* classes. The sprite is 6.78:1 (162.79x24), so width is fixed per size instead of
// the plugin's 1rem square.
export const OtelIcon: FC<Props> = ({ className }) => (
  <span
    aria-hidden
    className={cn('i-custom-public-tracing-otel-icon h-4 w-[6.78rem] shrink-0', className)}
  />
)

export const OtelIconBig: FC<Props> = ({ className }) => (
  <span
    aria-hidden
    className={cn('i-custom-public-tracing-otel-icon-big h-6 w-[10.17rem] shrink-0', className)}
  />
)
