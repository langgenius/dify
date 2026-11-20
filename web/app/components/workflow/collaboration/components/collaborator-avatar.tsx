import type { AvatarProps, AvatarSize } from '@langgenius/dify-ui/avatar'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@langgenius/dify-ui/avatar'
import { useState } from 'react'
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

const withoutQuery = (url: string) => url.split('?')[0]

/**
 * Avatar URLs are signed per response, so the same picture arrives under a new
 * query string after every refetch. Keep the URL this avatar already shows while
 * it points at the same file, so a refetch does not reload the image.
 */
function useStableImageSrc(src: string | undefined) {
  const [stableSrc, setStableSrc] = useState(src)
  const sameFile = src && stableSrc && withoutQuery(src) === withoutQuery(stableSrc)
  if (src !== stableSrc && !sameFile) setStableSrc(src)
  return sameFile ? stableSrc : src
}

export function CollaboratorAvatar({ collaborator, ...props }: CollaboratorAvatarProps) {
  const src = useStableImageSrc(collaborator.avatarUrl || undefined)
  return (
    <Avatar aria-hidden="true" {...props}>
      <AvatarFallback
        style={collaborator.color ? { backgroundColor: collaborator.color } : undefined}
      >
        {getAvatarInitial(collaborator.name)}
      </AvatarFallback>
      <AvatarImage src={src} alt="" />
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
