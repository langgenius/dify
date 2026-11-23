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
 * bubble whose bottom-start corner points at the comment position. Its
 * border is drawn above the avatars and turns into the selected outline.
 */
export function CommentMarker({ participants, selected, className, ...props }: CommentMarkerProps) {
  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        'relative flex min-h-6.75 min-w-6.75 items-center rounded-[13.5px] rounded-es-[3px] bg-components-panel-bg-blur p-[1.5px] shadow-lg backdrop-blur-[5px]',
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-[0.5px] after:border-components-panel-border',
        'data-selected:after:border-[1.5px] data-selected:after:border-components-option-card-option-selected-border',
        className,
      )}
      {...props}
    >
      <CollaboratorAvatarStack collaborators={participants} maxVisible={2} />
    </div>
  )
}
