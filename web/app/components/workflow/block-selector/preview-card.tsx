import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { PreviewCardContent, PreviewCardViewport } from '@langgenius/dify-ui/preview-card'

export function BlockSelectorPreviewCardContent({ children }: { children: ReactNode }) {
  return (
    <PreviewCardContent
      placement="right"
      className="h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] data-instant:transition-none motion-reduce:transition-none"
      popupClassName="relative h-[var(--popup-height,auto)] w-[var(--popup-width,auto)] overflow-hidden border-none transition-[width,height,transform,scale,opacity] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-instant:transition-none motion-reduce:transition-none"
    >
      <PreviewCardViewport
        className={cn(
          'relative h-full w-full overflow-clip',
          '**:data-current:w-56 **:data-current:translate-y-0 **:data-current:px-3 **:data-current:py-2.5 **:data-current:opacity-100 **:data-current:transition-[translate,opacity] **:data-current:duration-[180ms,90ms] **:data-current:ease-[cubic-bezier(0.22,1,0.36,1)]',
          '**:data-previous:w-56 **:data-previous:translate-y-0 **:data-previous:px-3 **:data-previous:py-2.5 **:data-previous:opacity-100 **:data-previous:transition-[translate,opacity] **:data-previous:duration-[180ms,90ms] **:data-previous:ease-[cubic-bezier(0.22,1,0.36,1)]',
          'data-instant:**:data-current:transition-none data-instant:**:data-previous:transition-none',
          "data-[activation-direction~='up']:**:data-current:data-starting-style:-translate-y-2 data-[activation-direction~='up']:**:data-current:data-starting-style:opacity-0",
          "data-[activation-direction~='up']:**:data-previous:data-ending-style:translate-y-2 data-[activation-direction~='up']:**:data-previous:data-ending-style:opacity-0",
          "data-[activation-direction~='down']:**:data-current:data-starting-style:translate-y-2 data-[activation-direction~='down']:**:data-current:data-starting-style:opacity-0",
          "data-[activation-direction~='down']:**:data-previous:data-ending-style:-translate-y-2 data-[activation-direction~='down']:**:data-previous:data-ending-style:opacity-0",
          'motion-reduce:**:data-current:transition-none motion-reduce:**:data-previous:transition-none',
        )}
      >
        {children}
      </PreviewCardViewport>
    </PreviewCardContent>
  )
}
