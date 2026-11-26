import type {
  CursorPosition,
  OnlineUser,
} from '@/app/components/workflow/collaboration/types/collaboration'
import { useViewport } from 'reactflow'
import { getUserColor } from '../utils/user-color'
import { CollaboratorCursor } from './collaborator-cursor'

type UserCursorsProps = {
  cursors: Record<string, CursorPosition>
  myUserId: string | null
  onlineUsers: OnlineUser[]
}

function UserCursors({ cursors, myUserId, onlineUsers }: UserCursorsProps) {
  const { x, y, zoom } = useViewport()

  return (
    <div
      className="pointer-events-none absolute inset-0 z-8 origin-top-left"
      style={{ translate: `${x}px ${y}px`, scale: zoom }}
    >
      {Object.entries(cursors).map(([userId, cursor]) => {
        if (userId === myUserId) return null

        const userInfo = onlineUsers.find((user) => user.user_id === userId)
        const userName = userInfo?.username || `User ${userId.slice(-4)}`
        const userColor = getUserColor(userId)

        return (
          <CollaboratorCursor
            key={userId}
            name={userName}
            color={userColor}
            className="absolute top-0 origin-top-left motion-safe:transition-[translate] motion-safe:duration-150 motion-safe:ease-out"
            style={{ left: 0, translate: `${cursor.x}px ${cursor.y}px`, scale: 1 / zoom }}
          />
        )
      })}
    </div>
  )
}

export default UserCursors
