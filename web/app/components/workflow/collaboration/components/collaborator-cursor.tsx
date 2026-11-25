import type { CSSProperties } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type CollaboratorCursorProps = {
  name: string
  color: string
  className?: string
  style?: CSSProperties
}

/**
 * A remote collaborator's pointer and name tag. The caller positions it; the
 * pointer tip sits at the element's top-left corner.
 */
export function CollaboratorCursor({ name, color, className, style }: CollaboratorCursorProps) {
  return (
    <div dir="ltr" className={cn('pointer-events-none', className)} style={style}>
      {/* The design's 24px pointer: a white outline under an arrow in the collaborator's
          color, with its tip at (7, 3). */}
      <span
        aria-hidden
        className="absolute -inset-s-1.75 -top-0.75 size-6 drop-shadow-[0_1px_1.8px_rgb(0_0_0/0.65)]"
      >
        <span className="absolute inset-0 i-custom-vender-workflow-collaborator-cursor-outline size-6 text-white" />
        <span
          className="absolute inset-0 i-custom-vender-workflow-collaborator-cursor-arrow size-6"
          style={{ color }}
        />
      </span>
      <div
        className="absolute inset-s-[13.5px] top-[17.5px] max-w-30 truncate rounded-sm border-[0.5px] border-divider-regular px-1.25 py-0.75 system-2xs-medium text-white shadow-md backdrop-blur-[5px]"
        style={{ backgroundColor: color }}
      >
        <span dir="auto">{name}</span>
      </div>
    </div>
  )
}
