import type { ComponentProps } from 'react'
import { AvatarGroup, AvatarGroupCount } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'

type CollaboratorPillProps = ComponentProps<'span'> & {
  /** People beyond the avatars shown; above zero the pill shows +N and a list chevron. */
  overflowCount?: number
}

/**
 * The online-collaborators pill: its children are the 24px avatars, overlapping
 * in an avatar group (give earlier ones a higher z-index to keep them on top),
 * then +N and a chevron when some people are folded into a list.
 */
export function CollaboratorPill({
  overflowCount = 0,
  className,
  children,
  ...props
}: CollaboratorPillProps) {
  const hasOverflow = overflowCount > 0

  return (
    <span
      className={cn(
        'flex items-center gap-px rounded-2xl border-[0.5px] border-components-panel-border py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
        hasOverflow ? 'bg-components-panel-bg ps-1 pe-1.5' : 'bg-components-panel-bg-blur px-1',
        className,
      )}
      {...props}
    >
      <AvatarGroup size="sm">
        {children}
        {hasOverflow && <AvatarGroupCount aria-hidden>+{overflowCount}</AvatarGroupCount>}
      </AvatarGroup>
      {hasOverflow && (
        <span aria-hidden className="i-ri-arrow-down-s-line size-3 text-text-tertiary" />
      )}
    </span>
  )
}
