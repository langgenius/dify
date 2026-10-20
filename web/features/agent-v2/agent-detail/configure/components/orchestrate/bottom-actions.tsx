import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export function AgentOrchestrateBottomActions({
  children,
  shrinkOnOpen = true,
}: {
  children: ReactNode
  shrinkOnOpen?: boolean
}) {
  return (
    <div className="pointer-events-none sticky bottom-0 flex shrink-0 flex-col items-center px-4 pt-4 pb-2">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-t from-components-panel-bg to-components-panel-bg-transparent mask-[linear-gradient(to_top,black,transparent)] backdrop-blur-[2px] [-webkit-mask-image:linear-gradient(to_top,black,transparent)]"
      />
      <div
        className={cn(
          'pointer-events-auto relative flex w-full max-w-126.5 flex-col items-center justify-end transition-[max-width] duration-150 ease-out motion-reduce:transition-none',
          shrinkOnOpen && 'has-data-open:max-w-96',
        )}
      >
        {children}
      </div>
    </div>
  )
}
