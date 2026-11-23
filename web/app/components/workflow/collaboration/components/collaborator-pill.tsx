import type { ComponentProps, ReactNode } from 'react'
import type { Collaborator } from './collaborator-avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { CollaboratorAvatar } from './collaborator-avatar'

type CollaboratorPillProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The avatars shown in the pill, left to right. */
  collaborators: Collaborator[]
  /** People beyond `collaborators`; above zero the pill shows +N and a list chevron. */
  overflowCount?: number
  /** Wraps each avatar, for example in a tooltip trigger. Must render the avatar. */
  renderAvatar?: (avatar: ReactNode, collaborator: Collaborator) => ReactNode
}

/**
 * The online-collaborators pill: overlapping 24px avatars, then +N and a
 * chevron when some people are folded into a list.
 */
export function CollaboratorPill({
  collaborators,
  overflowCount = 0,
  renderAvatar,
  className,
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
      {collaborators.map((collaborator, index) => {
        const avatar = (
          <CollaboratorAvatar
            collaborator={collaborator}
            size="sm"
            className="border border-components-panel-bg"
          />
        )
        return (
          <span
            key={collaborator.id}
            className={cn('relative flex rounded-full', index > 0 && '-ms-1')}
            style={{ zIndex: collaborators.length - index }}
          >
            {renderAvatar ? renderAvatar(avatar, collaborator) : avatar}
          </span>
        )
      })}
      {hasOverflow && (
        <>
          <span
            aria-hidden
            className="-ms-1 flex size-6 items-center justify-center rounded-full border border-components-panel-bg bg-components-icon-bg-midnight-solid text-2xs leading-3 font-semibold text-white select-none"
          >
            +{overflowCount}
          </span>
          <span aria-hidden className="i-ri-arrow-down-s-line size-3 text-text-tertiary" />
        </>
      )}
    </span>
  )
}
