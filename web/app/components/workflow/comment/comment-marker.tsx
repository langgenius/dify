import type { ComponentProps } from 'react'
import type { Collaborator } from '../collaboration/components/collaborator-avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { CollaboratorAvatarStack } from '../collaboration/components/collaborator-avatar'

type CommentMarkerProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Comment author first, then the other participants. */
  participants: Collaborator[]
  selected?: boolean
}

/**
 * The 27px comment pin on the canvas: up to two avatars (or one and +N) in a
 * bubble whose bottom-start corner points at the comment position. The
 * bubble's padding and border are rings around the avatars' own box; the
 * selected outline is a ring drawn above the avatars.
 */
export function CommentMarker({ participants, selected, className, ...props }: CommentMarkerProps) {
  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        'relative m-[1.5px] flex min-h-6 min-w-6 items-center rounded-xl rounded-es-[1.5px] bg-components-panel-bg-blur shadow-lg ring-[0.5px] ring-components-panel-border ring-offset-1 ring-offset-components-panel-bg-blur backdrop-blur-[5px]',
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit]',
        'data-selected:after:ring-[1.5px] data-selected:after:ring-components-option-card-option-selected-border',
        className,
      )}
      {...props}
    >
      <CollaboratorAvatarStack collaborators={participants} maxVisible={2} />
    </div>
  )
}
