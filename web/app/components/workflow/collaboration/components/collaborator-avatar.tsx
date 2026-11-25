import type { AvatarProps, AvatarSize } from '@langgenius/dify-ui/avatar'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@langgenius/dify-ui/avatar'
import { getAvatarInitial } from '@/utils/avatar'
import { getUserColor } from '../utils/user-color'

/**
 * A person shown in collaboration UI. Their collaborator color is the one for their `id`, the
 * same wherever and to whoever they are shown; pass `color` only when `id` is not their user
 * id, such as a session id.
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
        style={{ backgroundColor: collaborator.color ?? getUserColor(collaborator.id) }}
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
      {visible.map((collaborator) => (
        <CollaboratorAvatar
          key={collaborator.id}
          collaborator={collaborator}
          role="img"
          aria-hidden={undefined}
          aria-label={collaborator.name}
        />
      ))}
      {overflowCount > 0 && <AvatarGroupCount>+{overflowCount}</AvatarGroupCount>}
    </AvatarGroup>
  )
}
