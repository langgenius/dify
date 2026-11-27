import type { ComponentProps } from 'react'
import {
  createPopoverHandle,
  Popover,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { CommentIcon } from '../comment-icon'
import { getCommentMarkerId } from '../marker-id'
import { commentThreadPlacement } from '../popup-placement'
import { CommentThread } from '../thread'

type CommentThreadFixtureProps = ComponentProps<typeof CommentThread> & {
  onClose?: () => void
}

/** An open thread composed like the canvas entry: one marker trigger and the thread popover. */
export function CommentThreadFixture({ onClose, ...props }: CommentThreadFixtureProps) {
  const [handle] = useState(() => createPopoverHandle())
  const markerId = getCommentMarkerId(props.comment.id)

  return (
    <>
      <PopoverTrigger handle={handle} id={markerId}>
        Marker
      </PopoverTrigger>
      <Popover
        handle={handle}
        open
        triggerId={markerId}
        onOpenChange={(open) => {
          if (!open) onClose?.()
        }}
      >
        <PopoverPortal>
          <PopoverPositioner {...commentThreadPlacement}>
            <CommentThread {...props} />
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  )
}

type CommentMarkerFixtureProps = Omit<ComponentProps<typeof CommentIcon>, 'threadHandle'> & {
  onOpen?: () => void
}

/** A canvas marker wired to a thread popover whose owner only records open requests. */
export function CommentMarkerFixture({ onOpen, ...props }: CommentMarkerFixtureProps) {
  const [handle] = useState(() => createPopoverHandle())
  return (
    <>
      <CommentIcon {...props} threadHandle={handle} />
      <Popover
        handle={handle}
        open={false}
        onOpenChange={(open) => {
          if (open) onOpen?.()
        }}
      />
    </>
  )
}
