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
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-[72px] flex-col items-center justify-end px-4 pt-4 pb-2 transition-[height] duration-150 ease-out has-[[data-open]]:h-[307px] motion-reduce:transition-none">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-components-panel-bg to-components-panel-bg-transparent [mask-image:linear-gradient(to_top,black,transparent)] backdrop-blur-[2px] [-webkit-mask-image:linear-gradient(to_top,black,transparent)]"
      />
      <div
        className={cn(
          'relative z-10 flex w-full max-w-[506px] flex-col items-center justify-end transition-[max-width] duration-150 ease-out motion-reduce:transition-none',
          shrinkOnOpen && 'has-[[data-open]]:max-w-96',
        )}
      >
        {children}
      </div>
    </div>
  )
}
