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
    <div className={cn('pointer-events-none', className)} style={style}>
      <svg
        aria-hidden
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-md"
      >
        <path
          d="M5 3L5 15L8 11.5L11 16L13 15L10 10.5L14 10.5L5 3Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className="absolute inset-s-4 top-4 max-w-30 truncate rounded-sm border-[0.5px] border-divider-regular px-1.25 py-0.75 system-2xs-medium text-white shadow-md"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  )
}
