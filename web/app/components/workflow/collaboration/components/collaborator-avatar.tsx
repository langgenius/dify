import type { AvatarProps, AvatarSize } from '@langgenius/dify-ui/avatar'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@langgenius/dify-ui/avatar'
import { getAvatarInitial } from '@/utils/avatar'

/**
 * A person shown in collaboration UI. `color` is their collaborator color;
 * leave it out for the current user, whose avatar keeps the default fill.
 */
export type Collaborator = {
  id: string
  name: string
  avatarUrl?: string | null
  color?: string
}

type CollaboratorAvatarProps = Omit<AvatarProps, 'children'> & {
  collaborator: Collaborator
}

export function CollaboratorAvatar({ collaborator, ...props }: CollaboratorAvatarProps) {
  return (
    <Avatar aria-hidden="true" {...props}>
      <AvatarFallback
        style={collaborator.color ? { backgroundColor: collaborator.color } : undefined}
      >
        {getAvatarInitial(collaborator.name)}
      </AvatarFallback>
      <AvatarImage src={collaborator.avatarUrl || undefined} alt="" />
    </Avatar>
  )
}

type CollaboratorAvatarStackProps = {
  collaborators: Collaborator[]
  maxVisible?: number
  size?: AvatarSize
}

/**
 * Overlapping avatars; past `maxVisible` the last slot becomes a +N count.
 */
export function CollaboratorAvatarStack({
  collaborators,
  maxVisible = 3,
  size = 'sm',
}: CollaboratorAvatarStackProps) {
  if (!collaborators.length) return null

  const hasOverflow = collaborators.length > maxVisible
  const visible = collaborators.slice(0, hasOverflow ? Math.max(1, maxVisible - 1) : maxVisible)
  const overflowCount = collaborators.length - visible.length

  return (
    <AvatarGroup size={size}>
      {visible.map((collaborator, index) => (
        <CollaboratorAvatar
          key={collaborator.id}
          collaborator={collaborator}
          role="img"
          aria-hidden={undefined}
          aria-label={collaborator.name}
          style={{ zIndex: visible.length - index }}
        />
      ))}
      {overflowCount > 0 && <AvatarGroupCount>+{overflowCount}</AvatarGroupCount>}
    </AvatarGroup>
  )
}
